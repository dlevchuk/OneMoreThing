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
from urllib.error import HTTPError
from monitoring import Page, desired_rules, reconcile
from price_history import update_history
from catalog_status import completed_ids


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


def read_snapshot(api, path):
    try:
        return api(path, text=True)
    except HTTPError as exc:
        # The first successful check and its saved snapshot become visible separately.
        if exc.code == 404:
            exc.close()
            raise ValueError('Snapshot is not available yet') from None
        raise


SOURCE_REASONS = {
    'Watch has not been checked yet': 'pending',
    'Snapshot is not available yet': 'pending',
    'Watch is paused': 'paused',
    'Watch fetch failed': 'fetch_error',
    'Watch filter failed': 'filter_error',
    'Expected exactly one structured Product': 'no_unique_product',
    'No structured offers': 'no_offer',
    'Unknown or mixed offer currency': 'unsupported_currency',
    'Aggregate price range': 'price_range',
    'No exact structured price': 'no_exact_price',
    'Invalid structured price': 'invalid_price',
    'Ambiguous variants or sellers': 'ambiguous_price',
    'Price must match exactly once': 'price_rule_mismatch',
    'Invalid price': 'invalid_price',
    'Invalid price range or precision': 'invalid_price',
}


def export(config, wishes, previous, api, diagnostics=None):
    result = {}
    diagnostics = diagnostics if diagnostics is not None else {}
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
            if info.get('paused'):
                raise ValueError('Watch is paused')
            if info.get('last_error'):
                raise ValueError('Watch fetch failed')
            if info.get('consecutive_filter_failures'):
                raise ValueError('Watch filter failed')
            checked = float(info.get('last_checked', 0))
            if checked == 0:
                raise ValueError('Watch has not been checked yet')
            if checked < 0 or checked > datetime.now(timezone.utc).timestamp() + 300:
                raise ValueError('Invalid check timestamp')
            tax_included = None
            if rule.get('priceRegex'):
                price, stock = parse_snapshot(read_snapshot(api, watch + '/history/latest'), rule)
                currency = rule.get('currency', 'UAH')
                if not isinstance(currency, str) or not re.fullmatch('[A-Z]{3}', currency):
                    raise ValueError('Invalid configured currency')
            else:
                page = Page(read_snapshot(api, watch + '/history/latest?html=1'))
                price, stock = page.observation()
                currency = page.currency()
                tax_included = page.tax_included()
            result[wish_id] = {
                'price': price, 'currency': currency, 'availability': stock,
                'checkedAt': datetime.fromtimestamp(checked, timezone.utc).isoformat(),
                'url': url, 'store': rule['store'],
            }
            if tax_included is not None:
                result[wish_id]['taxIncluded'] = tax_included
        except (ValueError, KeyError, IndexError, TypeError, OSError, re.error) as exc:
            # Do not log API responses or credentials.
            reason = SOURCE_REASONS.get(str(exc)) if isinstance(exc, ValueError) else None
            diagnostics[wish_id] = reason or 'export_error'
            print(f'{wish_id}: {diagnostics[wish_id]}; retaining previous observation', file=sys.stderr)
            if wish_id in previous and previous[wish_id].get('url') == url:
                old = dict(previous[wish_id])
                old['checkFailed'] = True
                result[wish_id] = old
            # A completed sync can contain unavailable/unsupported shop data.
            # Unexpected API/configuration failures still fail the service.
            if reason is None:
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
    disabled_path = root / 'config/monitoring-disabled.json'
    disabled = json.loads(disabled_path.read_text()) if disabled_path.exists() else {}
    config = desired_rules(wishes, overrides, profiles, disabled)
    if args.plan:
        print(json.dumps(config, ensure_ascii=False, indent=2))
        return 0
    # Fail closed if the public completion service is unavailable: no deletion/recreation.
    completed = completed_ids(root)
    config = desired_rules(wishes, overrides, profiles, disabled, completed)
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
            if method in ('PUT', 'DELETE'):
                return content
            raise
    state_path = args.state or root / '.monitoring-state/watch-state.json'
    def checkpoint(state):
        state_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
        temporary.chmod(0o600)
        temporary.replace(state_path)
    desired_config = config
    config, errors = reconcile(config, api, checkpoint, completed)
    diagnostics = {}
    result, failed = export(config, wishes, previous, api, diagnostics)
    for wish_id in errors:
        if wish_id in previous and previous[wish_id].get('url') == desired_config[wish_id]['url']:
            result[wish_id] = {**previous[wish_id], 'checkFailed': True}
    failed = failed or bool(errors)
    report = {wish['id']: ('completed' if wish['id'] in completed else 'disabled' if wish['id'] not in config and wish['id'] not in errors
                          else errors.get(wish['id']) or diagnostics.get(wish['id']) or ('needs_review' if wish['id'] not in result or result[wish['id']].get('checkFailed') else 'ok'))
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
    history_path = root / 'data/price-history.json'
    history = json.loads(history_path.read_text()) if history_path.exists() else {}
    history = update_history(history, previous)
    history = update_history(history, result)
    history_temp = history_path.with_suffix('.tmp')
    history_temp.write_text(json.dumps(history, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
    history_temp.replace(history_path)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
