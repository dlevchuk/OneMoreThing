#!/usr/bin/env python3
"""Reconcile catalog watches and export verified price observations."""
import argparse
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
from monitoring import Page, desired_rules, reconcile


def parse_snapshot(text, rule):
    matches = list(re.finditer(rule['priceRegex'], text, re.I | re.M))
    if len(matches) != 1:
        raise ValueError('Price must match exactly once')
    raw = re.sub(r'[\s\u00a0\u202f]', '', matches[0].group(1))
    separator = rule.get('decimalSeparator', ',')
    if separator not in (',', '.'):
        raise ValueError('Invalid decimal separator')
    raw = raw.replace('.' if separator == ',' else ',', '').replace(separator, '.')
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:
        raise ValueError('Invalid price') from exc
    if not value.is_finite() or value <= 0 or value > 10000000 or value.as_tuple().exponent < -2:
        raise ValueError('Invalid price range or precision')
    available = bool(rule.get('inStockRegex') and re.search(rule['inStockRegex'], text, re.I | re.M))
    unavailable = bool(rule.get('outOfStockRegex') and re.search(rule['outOfStockRegex'], text, re.I | re.M))
    stock = 'in_stock' if available and not unavailable else 'out_of_stock' if unavailable and not available else 'unknown'
    return float(value), stock


def export(config, wishes, previous, api):
    result = {}
    failed = False
    active = {w['id'] for w in wishes}
    for wish_id, rule in config.items():
        if wish_id not in active:
            continue
        try:
            url = rule['url']
            if urlparse(url).scheme not in ('http', 'https') or not urlparse(url).hostname:
                raise ValueError('Invalid shop URL')
            watch = 'watch/' + quote(rule['watchId'], safe='')
            info = api(watch)
            if info.get('url') != url:
                raise ValueError('Watch URL does not match configured shop')
            if info.get('last_error') or info.get('paused') or info.get('consecutive_filter_failures'):
                raise ValueError('Watch is paused or failed')
            checked = float(info.get('last_checked', 0))
            if checked <= 0 or checked > datetime.now(timezone.utc).timestamp() + 300:
                raise ValueError('Invalid check timestamp')
            price, stock = (parse_snapshot(api(watch + '/history/latest', text=True), rule)
                            if rule.get('priceRegex') else Page(api(watch + '/history/latest?html=1', text=True)).observation())
            result[wish_id] = {
                'price': price, 'currency': 'UAH', 'availability': stock,
                'checkedAt': datetime.fromtimestamp(checked, timezone.utc).isoformat(),
                'url': url, 'store': rule['store'],
            }
        except (ValueError, KeyError, IndexError, TypeError, OSError, re.error) as exc:
            # Do not log API responses or credentials.
            print(f'{wish_id}: export failed ({type(exc).__name__}); retaining previous observation', file=sys.stderr)
            if wish_id in previous:
                old = dict(previous[wish_id])
                old['checkFailed'] = True
                result[wish_id] = old
            failed = True
    return result, failed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', action='store_true', help='Show desired watches without API calls or writes')
    parser.add_argument('--state', type=Path, help='Private watch mapping, outside the published repository')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root
    overrides = json.loads((root / 'config/price-watches.json').read_text())
    profiles = json.loads((root / 'config/shop-profiles.json').read_text())
    wishes = json.loads((root / 'data/wishes.json').read_text())
    config = desired_rules(wishes, overrides, profiles)
    if args.plan:
        print(json.dumps(config, ensure_ascii=False, indent=2))
        return 0
    target = root / 'data/prices.json'
    previous = json.loads(target.read_text()) if target.exists() else {}
    base = os.environ.get('CHANGEDETECTION_URL', 'http://127.0.0.1:5000').rstrip('/')
    key = os.environ.get('CHANGEDETECTION_API_KEY', '')
    if not key:
        parser.error('CHANGEDETECTION_API_KEY is required')
    def api(path, text=False, method='GET', payload=None):
        body = json.dumps(payload).encode() if payload is not None else None
        request = Request(base + '/api/v1/' + path, data=body, method=method,
                          headers={'x-api-key': key, 'Content-Type': 'application/json'})
        with urlopen(request, timeout=30) as response:
            body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ValueError('Response too large')
        content = body.decode('utf-8')
        if text or not content:
            return content if text else None
        try:
            return json.loads(content)
        except ValueError:
            if method == 'PUT':
                return content
            raise
    state_path = args.state or root / '.monitoring-state/watch-state.json'
    def checkpoint(state):
        state_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
        temporary.chmod(0o600)
        temporary.replace(state_path)
    config, errors = reconcile(config, api, checkpoint)
    result, failed = export(config, wishes, previous, api)
    for wish_id in errors:
        if wish_id in previous:
            result[wish_id] = {**previous[wish_id], 'checkFailed': True}
    failed = failed or bool(errors)
    report = {wish['id']: ('disabled' if wish['id'] not in config and wish['id'] not in errors
                          else errors.get(wish['id']) or ('needs_review' if wish['id'] not in result or result[wish['id']].get('checkFailed') else 'ok'))
              for wish in wishes}
    report_path = root / 'data/monitoring-status.json'
    report_temp = report_path.with_suffix('.tmp')
    report_temp.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
    report_temp.replace(report_path)
    content = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
    if not target.exists() or target.read_text() != content:
        temp = target.with_suffix('.tmp')
        temp.write_text(content)
        temp.replace(target)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
