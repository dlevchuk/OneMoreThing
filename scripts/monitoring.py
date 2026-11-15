"""Shared metadata extraction and changedetection watch reconciliation."""
import hashlib
from html.parser import HTMLParser
from html import unescape
import re
import json
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin, urlparse, quote

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
        self.script = None
        self.in_title = False
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta':
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

    def currency(self):
        products = self.products()
        if len(products) != 1:
            raise ValueError('Expected exactly one structured Product')
        offers = products[0].get('offers', [])
        offers = [offers] if isinstance(offers, dict) else offers
        if not isinstance(offers, list) or not offers:
            raise ValueError('No structured offers')
        currencies = {offer.get('priceCurrency') if isinstance(offer, dict) else None for offer in offers}
        if len(currencies) != 1:
            raise ValueError('Unknown or mixed offer currency')
        currency = currencies.pop()
        if not isinstance(currency, str) or not re.fullmatch('[A-Z]{3}', currency):
            raise ValueError('Unknown or mixed offer currency')
        return currency

    def observation(self):
        products = self.products()
        if len(products) != 1:
            raise ValueError('Expected exactly one structured Product')
        offers = products[0].get('offers', [])
        if isinstance(offers, dict):
            offers = [offers]
        if not isinstance(offers, list) or not offers:
            raise ValueError('No structured offers')
        currency = self.currency()
        candidates = set()
        for offer in offers:
            if not isinstance(offer, dict) or offer.get('priceCurrency') != currency:
                raise ValueError('Unknown or mixed offer currency')
            # AggregateOffer lowPrice is a range, not a specific shop price.
            if offer.get('@type') == 'AggregateOffer' or 'lowPrice' in offer or 'highPrice' in offer:
                raise ValueError('Aggregate price range')
            try:
                value = Decimal(str(offer['price']))
            except (KeyError, InvalidOperation):
                raise ValueError('No exact structured price') from None
            if not value.is_finite() or not 0 < value <= 10000000 or value.as_tuple().exponent < -2:
                raise ValueError('Invalid structured price')
            availability = str(offer.get('availability', '')).rsplit('/', 1)[-1]
            stock = {'InStock': 'in_stock', 'LimitedAvailability': 'in_stock', 'OutOfStock': 'out_of_stock',
                     'SoldOut': 'out_of_stock', 'Discontinued': 'out_of_stock'}.get(availability, 'unknown')
            candidates.add((float(value), stock))
        if len(candidates) != 1:
            raise ValueError('Ambiguous variants or sellers')
        return candidates.pop()


def marker(wish_id, url):
    return PREFIX + quote(str(wish_id), safe='') + '/' + hashlib.sha256(url.encode()).hexdigest()[:16]


def desired_rules(wishes, overrides, profiles):
    rules = {}
    for wish in wishes:
        wish_id = wish['id']
        monitoring = wish.get('monitoring', {})
        if monitoring is False or (isinstance(monitoring, dict) and monitoring.get('enabled') is False):
            continue
        if not isinstance(monitoring, dict):
            raise ValueError('monitoring must be an object or false')
        override = overrides.get(wish_id, {})
        url = wish.get('originalUrl')
        if not url:
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


def reconcile(rules, api, checkpoint):
    """Only deterministic names owned by this integration may be updated/paused."""
    watches = api('watch')
    if not isinstance(watches, dict):
        raise ValueError('Invalid watch listing')
    by_marker = {}
    for uuid, item in watches.items():
        name = (item.get('title') or '').split(' | ', 1)[0]
        if name.startswith(PREFIX):
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
