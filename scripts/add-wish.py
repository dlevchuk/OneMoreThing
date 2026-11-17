#!/usr/bin/env python3
"""Import a wishlist card from a single public product URL, without credentials."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from monitoring import Page, public_url


def checked_url(url):
    public_url(url)
    hostname = urlparse(url).hostname
    for address in socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(address[4][0]).is_global:
            raise ValueError('Product host resolves to a private address')
    return url


class PublicRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, checked_url(newurl))


def make_card(url, html, priority='unsure', title=None):
    page = Page(html)
    if title:
        page.meta['og:title'] = title
    if not title and not page.products() and not (page.meta.get('og:title') and page.meta.get('og:image')):
        raise ValueError('No product metadata; check for anti-bot page or supply --title')
    data = page.metadata(url)
    if title:
        data['title'] = title
    slug = re.sub('[^a-z0-9]+', '-', data['title'].lower()).strip('-')[:60] or 'product'
    identifier = slug + '-' + hashlib.sha256(url.encode()).hexdigest()[:8]
    return {'id': identifier, **data, 'image': data['image'] or 'assets/favicon.svg',
            'originalUrl': url, 'priority': priority}


def probe_source(url, html, profiles):
    profile = profiles.get(urlparse(url).hostname, {})
    if profile.get('priceRegex'):
        raise ValueError('This source requires a text-selector check before automatic import')
    source = profile.get('priceSource', 'auto')
    page = Page(html)
    price, stock = page.observation(source)
    return {'price': price, 'currency': page.currency(source), 'availability': stock}


def preflight_card(card, html, profiles, allow_unmonitored=False):
    try:
        result = probe_source(card['originalUrl'], html, profiles)
        return card, result
    except ValueError as exc:
        if not allow_unmonitored:
            raise ValueError('Source price is not readable: ' + str(exc) +
                             '. Choose another source or explicitly allow an unmonitored card.') from None
        return {**card, 'monitoring': False}, {'status': 'unmonitored', 'reason': str(exc)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url')
    parser.add_argument('--priority', choices=['want', 'nice', 'unsure'], default='unsure')
    parser.add_argument('--title', help='Override title when the shop metadata needs correction')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--preview', action='store_true')
    parser.add_argument('--allow-unmonitored', action='store_true', help='Explicitly allow a card whose price cannot be parsed; monitoring stays disabled')
    args = parser.parse_args()
    path = args.root / 'data/wishes.json'
    wishes = json.loads(path.read_text())
    if any(args.url in [w.get('localUrl'), w.get('originalUrl'),
                       w.get('monitoring', {}).get('url') if isinstance(w.get('monitoring', {}), dict) else None]
           for w in wishes):
        print('This URL already exists; no changes')
        return
    request = Request(checked_url(args.url), headers={'User-Agent': 'Mozilla/5.0'})
    with build_opener(PublicRedirects()).open(request, timeout=30) as response:
        if 'html' not in response.headers.get_content_type():
            raise ValueError('Expected an HTML product page')
        content = response.read(2_000_001)
        if len(content) > 2_000_000:
            raise ValueError('Page exceeds 2 MB')
        html = content.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
    card = make_card(args.url, html, args.priority, args.title)
    profiles = json.loads((args.root / 'config/shop-profiles.json').read_text())
    try:
        card, source = preflight_card(card, html, profiles, args.allow_unmonitored)
    except ValueError as exc:
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
                summary.write('### Source check failed\nNo card was added. Choose another product page or explicitly allow a card without monitoring.\n')
        parser.error(str(exc))
    print(json.dumps({'sourceCheck': source}, ensure_ascii=False))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write('### Source check\n' + ('Price verified: ' + str(source['price']) + ' ' + source['currency'] if 'price' in source else 'Added without monitoring by explicit request') + '\n')
    print(json.dumps(card, ensure_ascii=False, indent=2))
    if args.preview:
        return
    if any(w['id'] == card['id'] for w in wishes):
        raise ValueError('Generated ID already exists')
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(wishes + [card], ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)
    # The booking catalog is synchronized by the deploy workflow (Edge Function sync-catalog).


if __name__ == '__main__':
    main()
