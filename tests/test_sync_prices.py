import importlib.util
from pathlib import Path
import unittest
import sys
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))

spec = importlib.util.spec_from_file_location('sync_prices', Path(__file__).parents[1] / 'scripts/sync-prices.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

RULE = {'watchId': 'test', 'url': 'https://shop.example/item', 'store': 'Shop',
        'priceRegex': r'Ціна: ([\d\s,]+) грн', 'inStockRegex': r'^Є в наявності$',
        'outOfStockRegex': r'^Немає в наявності$'}

class ExportTest(unittest.TestCase):
    def test_localized_price(self):
        self.assertEqual(m.parse_snapshot('Ціна: 12\u00a0345,50 грн\nЄ в наявності', RULE), (12345.5, 'in_stock'))

    def test_ambiguous_or_invalid_price(self):
        for text in ['Ціна: 100 грн\nЦіна: 200 грн', 'Ціна: 0 грн', 'Ціна: 1,234 грн', 'Captcha']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                m.parse_snapshot(text, RULE)

    def test_conflicting_stock_is_unknown(self):
        self.assertEqual(m.parse_snapshot('Ціна: 100 грн\nЄ в наявності\nНемає в наявності', RULE)[1], 'unknown')

    def test_failed_check_keeps_original_timestamp(self):
        old = {'gift': {'price': 100, 'checkedAt': '2026-11-01T00:00:00+00:00'}}
        result, failed = m.export({'gift': RULE}, [{'id': 'gift'}], old, lambda path: {'url': RULE['url'], 'last_error': 'blocked'})
        self.assertFalse(failed)
        self.assertEqual(result['gift']['checkedAt'], old['gift']['checkedAt'])
        self.assertTrue(result['gift']['checkFailed'])
        self.assertNotIn('checkFailed', old['gift'])

    def test_source_conditions_do_not_fail_completed_sync(self):
        for info, snapshot, expected in [
            ({'last_checked': 0}, '', 'pending'),
            ({'last_error': 'blocked'}, '', 'fetch_error'),
            ({'last_checked': 1700000000}, '<html>No product</html>', 'no_unique_product'),
        ]:
            with self.subTest(expected=expected):
                diagnostics = {}
                def api(path, text=False):
                    return snapshot if text else {'url': RULE['url'], **info}
                _, failed = m.export({'gift': {key: value for key, value in RULE.items() if key != 'priceRegex'}}, [{'id': 'gift'}], {}, api, diagnostics)
                self.assertFalse(failed)
                self.assertEqual(diagnostics['gift'], expected)

    def test_api_failure_still_fails_service(self):
        def api(path):
            raise OSError('API unavailable')
        diagnostics = {}
        _, failed = m.export({'gift': RULE}, [{'id': 'gift'}], {}, api, diagnostics)
        self.assertTrue(failed)
        self.assertEqual(diagnostics['gift'], 'export_error')

    def test_inactive_mapping_is_removed(self):
        result, failed = m.export({'gift': RULE}, [], {'gift': {}}, lambda _: self.fail('Unexpected request'))
        self.assertEqual(result, {})
        self.assertFalse(failed)

    def test_success_and_watch_url_mismatch(self):
        def api(path, text=False):
            return 'Ціна: 999 грн\nЄ в наявності' if text else {'url': RULE['url'], 'last_checked': 1700000000}
        result, failed = m.export({'gift': RULE}, [{'id': 'gift'}], {}, api)
        self.assertFalse(failed)
        self.assertEqual(result['gift']['price'], 999)
        result, failed = m.export({'gift': {**RULE, 'url': 'https://other.example'}}, [{'id': 'gift'}], {}, api)
        self.assertTrue(failed)
        self.assertEqual(result, {})


class PipelineTest(unittest.TestCase):
    def test_full_sync_creates_once_exports_structured_price_and_keeps_private_state(self):
        import io
        import json
        import os
        import tempfile
        from unittest.mock import patch
        watches = {}
        creates = []
        product_html = '<script type="application/ld+json">' + json.dumps({
            '@type': 'Product', 'name': 'Gift', 'offers': {'price': '100.50', 'priceCurrency': 'UAH',
            'availability': 'https://schema.org/InStock'}}) + '</script>'
        def request(req, timeout):
            path = req.full_url.split('/api/v1/', 1)[1]
            if req.get_method() == 'POST':
                payload = json.loads(req.data)
                creates.append(payload)
                watches['created'] = {**payload, 'last_checked': 1700000000}
                value = {'uuid': 'created'}
            elif path == 'watch':
                value = watches
            elif path == 'watch/created':
                value = watches['created']
            elif path == 'watch/created/history/latest?html=1':
                return io.BytesIO(product_html.encode())
            else:
                raise AssertionError(path)
            return io.BytesIO(json.dumps(value).encode())
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'data').mkdir()
            (root / 'config').mkdir()
            (root / 'data/wishes.json').write_text(json.dumps([{'id': 'gift', 'title': 'Gift', 'localUrl': 'https://shop.example/item'}]))
            for name in ['shop-profiles', 'price-watches']:
                (root / f'config/{name}.json').write_text('{}')
            with patch.object(sys, 'argv', ['sync-prices.py', '--root', str(root), '--state', str(root / 'private/state.json')]), patch.dict(os.environ, {'CHANGEDETECTION_API_KEY': 'test-key'}), patch.object(m, 'urlopen', request):
                self.assertEqual(m.main(), 0)
                self.assertEqual(m.main(), 0)
            self.assertEqual(len(creates), 1)
            self.assertEqual(json.loads((root / 'data/prices.json').read_text())['gift']['price'], 100.5)
            self.assertEqual(json.loads((root / 'data/monitoring-status.json').read_text()), {'gift': 'ok'})
            self.assertEqual((root / 'private/state.json').stat().st_mode & 0o777, 0o600)
            self.assertNotIn('created', (root / 'data/prices.json').read_text())


if __name__ == '__main__':
    unittest.main()
