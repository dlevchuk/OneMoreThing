"""Shared metadata extraction and changedetection watch reconciliation."""
import hashlib
from html.parser import HTMLParser
from html import unescape
import re
import json
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin, urlparse, quote, unquote

PREFIX = 'OneMoreThing/'


def public_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Expected a public HTTP(S) product URL')
    import ipaddress
    host = parsed.hostname.lower().rstrip('.')
    if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal', '.ts.net')):
        raise ValueError('Local URLs are not product sources')
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return url
    if not address.is_global:
        raise ValueError('Local addresses are not product sources')
    return url


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.meta, self.blocks, self.title = {}, [], ''
        self.price_meta = {}
        self.micro = {}
        self.micro_products = 0
        self.script = None
        self.in_title = False
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'itemscope' in attrs and str(attrs.get('itemtype', '')).rstrip('/').endswith('/Product'):
            self.micro_products += 1
        for prop in (attrs.get('itemprop') or '').split():
            if prop in ('price', 'priceCurrency', 'availability'):
                value = attrs.get('content') or attrs.get('href') or attrs.get('value')
                if value:
                    self.micro.setdefault(prop, []).append(value)
        if tag == 'meta':
            name = attrs.get('property', attrs.get('name', ''))
            if name.startswith(('product:price:', 'og:price:')):
                self.price_meta.setdefault(name, set()).add(attrs.get('content', ''))
            self.meta[attrs.get('property', attrs.get('name', ''))] = attrs.get('content', '')
        if tag == 'script' and attrs.get('type', '').split(';')[0].strip().lower() == 'application/ld+json':
            self.script = ''
        if tag == 'title':
            self.in_title = True

    def handle_data(self, data):
        if self.script is not None:
            self.script += data
        if self.in_title:
            self.title += data

    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            try:
                self.blocks.append(json.loads(self.script))
            except (ValueError, TypeError):
                pass
            self.script = None
        if tag == 'title':
            self.in_title = False

    def products(self):
        def walk(node):
            if isinstance(node, list):
                for item in node:
                    yield from walk(item)
            elif isinstance(node, dict):
                kind = node.get('@type', [])
                kinds = [kind] if isinstance(kind, str) else kind if isinstance(kind, list) else []
                if any(str(value).rsplit('/', 1)[-1] == 'Product' for value in kinds):
                    yield node
                elif '@graph' in node:
                    yield from walk(node['@graph'])
        return list(walk(self.blocks))

    def metadata(self, url):
        products = self.products()
        product = products[0] if len(products) == 1 else {}
        image = product.get('image') or self.meta.get('og:image', '')
        if isinstance(image, list):
            image = image[0] if image else ''
        if isinstance(image, dict):
            image = image.get('url', '')
        title = product.get('name') or self.meta.get('og:title') or self.title
        if not isinstance(title, str) or not title.strip():
            raise ValueError('No product title; supply --title')
        description = str(product.get('description') or self.meta.get('og:description') or self.meta.get('description', ''))
        description = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', description))).strip()
        return dict(title=unescape(title).strip()[:300], image=urljoin(url, image) if isinstance(image, str) and image else '',
                    description=description[:1000])

    @staticmethod
    def stock(value):
        return {'InStock': 'in_stock', 'LimitedAvailability': 'in_stock',
                'OutOfStock': 'out_of_stock', 'SoldOut': 'out_of_stock',
                'Discontinued': 'out_of_stock'}.get(str(value).rsplit('/', 1)[-1], 'unknown')

    @staticmethod
    def exact_price(value):
        try:
            price = Decimal(str(value))
        except InvalidOperation:
            raise ValueError('Invalid structured price') from None
        if not price.is_finite() or not 0 < price <= 10000000 or price.as_tuple().exponent < -2:
            raise ValueError('Invalid structured price')
        return float(price)

    def records(self, price_source='auto'):
        if price_source not in ('auto', 'page_metadata'):
            raise ValueError('Unknown price source')
        products = self.products()
        if len(products) > 1:
            raise ValueError('Expected exactly one structured Product')
        offers = products[0].get('offers', []) if products and price_source == 'auto' else []
        offers = [offers] if isinstance(offers, dict) else offers
        records = set()
        if offers:
            if not isinstance(offers, list):
                raise ValueError('No structured offers')
            for offer in offers:
                if not isinstance(offer, dict):
                    raise ValueError('No structured offers')
                if offer.get('@type') == 'AggregateOffer' or (('lowPrice' in offer or 'highPrice' in offer) and 'price' not in offer):
                    raise ValueError('Aggregate price range')
                specs = offer.get('priceSpecification', [])
                specs = [specs] if isinstance(specs, dict) else specs
                if not isinstance(specs, list):
                    raise ValueError('No exact structured price')
                sources = ([offer] if 'price' in offer else []) + specs
                if not sources:
                    raise ValueError('No exact structured price')
                for source in sources:
                    if not isinstance(source, dict) or 'price' not in source:
                        raise ValueError('No exact structured price')
                    currency = source.get('priceCurrency', offer.get('priceCurrency'))
                    if offer.get('priceCurrency') and currency != offer['priceCurrency']:
                        raise ValueError('Unknown or mixed offer currency')
                    tax = source.get('valueAddedTaxIncluded', offer.get('valueAddedTaxIncluded'))
                    if tax is not None and not isinstance(tax, bool):
                        raise ValueError('Invalid tax metadata')
                    records.add((self.exact_price(source['price']), currency,
                                 self.stock(offer.get('availability')), tax))
        else:
            if self.micro_products > 1:
                raise ValueError('Expected exactly one structured Product')
            # Explicit product price metadata only; never use unrelated numbers or pretax fields.
            for prefix in ('product:price:', 'og:price:'):
                if any(len(self.price_meta.get(prefix + field, set())) > 1 for field in ('amount', 'currency')):
                    raise ValueError('Ambiguous variants or sellers')
                amount, currency = self.meta.get(prefix + 'amount'), self.meta.get(prefix + 'currency')
                if amount is not None:
                    records.add((self.exact_price(amount), currency, 'unknown', None))
            prices = set(self.micro.get('price', []))
            currencies = set(self.micro.get('priceCurrency', []))
            if prices:
                if len(prices) != 1 or len(currencies) != 1:
                    raise ValueError('Ambiguous variants or sellers')
                stock_states = {self.stock(value) for value in self.micro.get('availability', [])}
                stock = stock_states.pop() if len(stock_states) == 1 else 'unknown'
                records.add((self.exact_price(prices.pop()), currencies.pop(), stock, None))
            if not records:
                raise ValueError('No structured offers' if products else 'Expected exactly one structured Product')
            # OG and microdata may repeat the same price with different stock detail.
            values = {(r[0], r[1]) for r in records}
            if len(values) == 1:
                stock_states = {r[2] for r in records if r[2] != 'unknown'}
                stock = stock_states.pop() if len(stock_states) == 1 else 'unknown'
                price, currency = values.pop()
                records = {(price, currency, stock, None)}
        currencies = {r[1] for r in records}
        if len(currencies) != 1 or not all(isinstance(c, str) and re.fullmatch('[A-Z]{3}', c) for c in currencies):
            raise ValueError('Unknown or mixed offer currency')
        if len(records) != 1:
            raise ValueError('Ambiguous variants or sellers')
        return next(iter(records))

    def currency(self, price_source='auto'):
        return self.records(price_source)[1]

    def tax_included(self, price_source='auto'):
        return self.records(price_source)[3]

    def observation(self, price_source='auto'):
        price, _, stock, _ = self.records(price_source)
        return price, stock


def marker(wish_id, url):
    return PREFIX + quote(str(wish_id), safe='') + '/' + hashlib.sha256(url.encode()).hexdigest()[:16]


def desired_rules(wishes, overrides, profiles, disabled=None, completed=None):
    rules = {}
    for wish in wishes:
        wish_id = wish['id']
        if wish_id in (completed or set()):
            continue
        monitoring = wish.get('monitoring', {})
        if monitoring is False or (isinstance(monitoring, dict) and monitoring.get('enabled') is False):
            continue
        if not isinstance(monitoring, dict):
            raise ValueError('monitoring must be an object or false')
        override = overrides.get(wish_id, {})
        url = wish.get('originalUrl')
        if not url:
            continue
        if (disabled or {}).get(wish_id, {}).get('url') == url:
            continue
        public_url(url)
        # Legacy rules for local shops must not redirect source-only monitoring.
        if override.get('url') != url:
            override = {}
        host = urlparse(url).hostname
        profile_key = monitoring.get('profile', host)
        if 'profile' in monitoring and profile_key not in profiles:
            raise ValueError('Unknown monitoring profile')
        profile = profiles.get(profile_key, {})
        rules[wish_id] = {**profile, **override, **monitoring, 'url': url,
                          'store': monitoring.get('store') or override.get('store') or profile.get('store') or host,
                          'title': wish['title']}
    return rules


def reconcile(rules, api, checkpoint, completed=None):
    """Only deterministic names owned by this integration may be updated/paused."""
    watches = api('watch')
    if not isinstance(watches, dict):
        raise ValueError('Invalid watch listing')
    by_marker = {}
    for uuid, item in watches.items():
        name = (item.get('title') or '').split(' | ', 1)[0]
        if name.startswith(PREFIX):
            wish_id = unquote(name[len(PREFIX):].split('/', 1)[0])
            if wish_id in (completed or set()):
                api('watch/' + quote(uuid, safe=''), method='DELETE')
                continue
            by_marker.setdefault(name, []).append((uuid, item))
    wanted = {marker(wid, rule['url']) for wid, rule in rules.items() if not rule.get('watchId')}
    resolved, state, errors = {}, {}, {}
    for wish_id, rule in rules.items():
        if rule.get('watchId'):
            resolved[wish_id] = rule
            continue
        name = marker(wish_id, rule['url'])
        matches = by_marker.get(name, [])
        existing_manual = [(uuid, item) for uuid, item in watches.items()
                           if item.get('url') == rule['url'] and not (item.get('title') or '').startswith(PREFIX)]
        if not matches and len(existing_manual) == 1:
            uuid, _ = existing_manual[0]
            resolved[wish_id] = {**rule, 'watchId': uuid}
            state[wish_id] = {'watchId': uuid, 'url': rule['url']}
            checkpoint(state)
            continue
        if len(matches) > 1 or (not matches and len(existing_manual) > 1):
            errors[wish_id] = 'duplicate_watches'
            continue
        try:
            title = name + ' | ' + rule['title'][:200]
            if matches:
                uuid, info = matches[0]
                if info.get('url') != rule['url']:
                    raise ValueError('Managed watch URL mismatch')
                update = {}
                if info.get('paused') or info.get('title') != title:
                    update.update(paused=False, title=title)
                if 'includeFilters' in rule:
                    details = api('watch/' + quote(uuid, safe=''))
                    if details.get('include_filters', []) != rule['includeFilters']:
                        update['include_filters'] = rule['includeFilters']
                if update:
                    api('watch/' + quote(uuid, safe=''), method='PUT', payload=update)
            else:
                payload = {'url': rule['url'], 'title': title, 'paused': False,
                           'time_between_check': {'hours': 6}, 'time_between_check_use_default': False,
                           'processor': 'text_json_diff', 'track_ldjson_price_data': True}
                if 'includeFilters' in rule:
                    payload['include_filters'] = rule['includeFilters']
                created = api('watch', method='POST', payload=payload)
                uuid = created['uuid']
            state[wish_id] = {'watchId': uuid, 'url': rule['url']}
            checkpoint(state)
            resolved[wish_id] = {**rule, 'watchId': uuid}
        except (ValueError, OSError, KeyError, TypeError):
            errors[wish_id] = 'watch_sync_failed'
    # No deletion: retain history. Never pause user-created or explicit watches.
    explicit_ids = {rule['watchId'] for rule in rules.values() if rule.get('watchId')}
    for name, matches in by_marker.items():
        if name not in wanted:
            for uuid, info in matches:
                if uuid not in explicit_ids and not info.get('paused'):
                    api('watch/' + quote(uuid, safe=''), method='PUT', payload={'paused': True})
    return resolved, errors
