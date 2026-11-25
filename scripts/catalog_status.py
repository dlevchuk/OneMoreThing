"""Read only the public status of completed and archived wishes already exposed to the wishlist browser."""
import json
from pathlib import Path
import re
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def completed_ids(root, opener=urlopen):
    path = root / 'config/catalog-status.json'
    if not path.exists():
        return set()
    settings = json.loads(path.read_text())
    site = settings['siteUrl'].rstrip('/')
    parsed = urlparse(site)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Invalid public site URL')
    with opener(site + '/js/supabase-config.js', timeout=20) as response:
        body = response.read(100001).decode('utf-8')
    if len(body) > 100000:
        raise ValueError('Public config too large')
    match = re.search(r'window\.SUPABASE_CONFIG\s*=\s*(\{.*\})\s*;', body, re.S)
    if not match:
        raise ValueError('Missing public API configuration')
    config = json.loads(match.group(1))
    base, key = config['url'].strip().rstrip('/'), config['anonKey'].strip()
    host = urlparse(base)
    if host.scheme != 'https' or not host.hostname or not host.hostname.endswith('.supabase.co') or host.username or host.password or not key:
        raise ValueError('Invalid public API configuration')
    # Never read bookings, notes, private owner state or use privileged credentials.
    result = set()
    offset = 0
    while True:
        request = Request(base + '/rest/v1/gift_catalog?select=wish_id&active=eq.true&or=(completed_at.not.is.null,archived_at.not.is.null)&limit=1000&offset=' + str(offset),
                          headers={'apikey': key, 'Authorization': 'Bearer ' + key})
        with opener(request, timeout=20) as response:
            rows = json.loads(response.read(1_000_001))
        if not isinstance(rows, list) or any(not isinstance(row.get('wish_id'), str) for row in rows):
            raise ValueError('Invalid completion response')
        result.update(row['wish_id'] for row in rows)
        if len(rows) < 1000:
            return result
        offset += 1000
