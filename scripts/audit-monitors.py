#!/usr/bin/env python3
"""Audit integration-owned watches; --prune deletes confirmed failing sources."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from monitoring import desired_rules, marker
from catalog_status import completed_ids

TERMINAL = {'fetch_error', 'filter_error', 'no_offer', 'no_unique_product', 'price_range',
            'no_exact_price', 'unsupported_currency', 'invalid_price', 'ambiguous_price', 'price_rule_mismatch'}


def audit(root, api, prune=False):
    wishes = json.loads((root / 'data/wishes.json').read_text())
    completed = completed_ids(root)
    rules = desired_rules([wish for wish in wishes if wish['id'] not in completed], json.loads((root / 'config/price-watches.json').read_text()),
                          json.loads((root / 'config/shop-profiles.json').read_text()))
    watches = api('watch')
    owned, report = {}, {}
    for wid, rule in rules.items():
        candidates = [(uuid, item) for uuid, item in watches.items()
                      if (item.get('title') or '').split(' | ', 1)[0] == marker(wid, rule['url']) and item.get('url') == rule['url']]
        if len(candidates) == 1:
            owned[wid] = {**rule, 'watchId': candidates[0][0]}
        else:
            report[wid] = 'not_owned_or_ambiguous'
    spec = importlib.util.spec_from_file_location('price_exporter', Path(__file__).with_name('sync-prices.py'))
    exporter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exporter)
    diagnostics = {}
    _, failed = exporter.export(owned, wishes, {}, api, diagnostics)
    report.update({wid: diagnostics.get(wid, 'ok') for wid in owned})
    if failed:
        raise RuntimeError('API/configuration failure: no monitors were deleted')
    if prune:
        path = root / 'config/monitoring-disabled.json'
        disabled = json.loads(path.read_text()) if path.exists() else {}
        for wid, status in report.items():
            if status not in TERMINAL:
                continue
            rule = owned[wid]
            # Persist suppression before DELETE, so reconciliation cannot recreate it.
            disabled[wid] = {'url': rule['url'], 'reason': status}
            temp = path.with_suffix('.tmp')
            temp.write_text(json.dumps(disabled, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
            temp.replace(path)
            api('watch/' + quote(rule['watchId'], safe=''), method='DELETE')
            report[wid] = 'deleted:' + status
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--prune', action='store_true')
    args = parser.parse_args()
    key = os.environ.get('CHANGEDETECTION_API_KEY')
    if not key:
        parser.error('CHANGEDETECTION_API_KEY is required')
    base = os.environ.get('CHANGEDETECTION_URL', 'http://127.0.0.1:5000').rstrip('/')
    def api(path, text=False, method='GET'):
        with urlopen(Request(base + '/api/v1/' + path, headers={'x-api-key': key}, method=method), timeout=30) as response:
            body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ValueError('Response too large')
        if method == 'DELETE':
            return None
        if text:
            return body.decode()
        return json.loads(body) if body else None
    print(json.dumps(audit(args.root, api, args.prune), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
