#!/usr/bin/env python3
"""Import a wishlist card from a single public product URL, without credentials."""
import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import socket
import subprocess
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url')
    parser.add_argument('--priority', choices=['want', 'nice', 'unsure'], default='unsure')
    parser.add_argument('--title', help='Override title when the shop metadata needs correction')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--preview', action='store_true')
    args = parser.parse_args()
    path = args.root / 'data/wishes.json'
    wishes = json.loads(path.read_text())
    if any(args.url in [w.get('localUrl'), w.get('originalUrl'),
                       w.get('monitoring', {}).get('url') if isinstance(w.get('monitoring', {}), dict) else None]
           for w in wishes):
        print('This URL already exists; no changes')
        return
    request = Request(checked_url(args.url), headers={'User-Agent': 'WishlistMetadataImporter/1.0'})
    with build_opener(PublicRedirects()).open(request, timeout=30) as response:
        if 'html' not in response.headers.get_content_type():
            raise ValueError('Expected an HTML product page')
        content = response.read(2_000_001)
        if len(content) > 2_000_000:
            raise ValueError('Page exceeds 2 MB')
        html = content.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
    card = make_card(args.url, html, args.priority, args.title)
    print(json.dumps(card, ensure_ascii=False, indent=2))
    if args.preview:
        return
    if any(w['id'] == card['id'] for w in wishes):
        raise ValueError('Generated ID already exists')
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(wishes + [card], ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)
    subprocess.run(['node', 'scripts/sync-catalog.mjs'], cwd=args.root, check=True)


if __name__ == '__main__':
    main()
