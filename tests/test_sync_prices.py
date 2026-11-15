import importlib.util
from pathlib import Path
import unittest

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
        self.assertTrue(failed)
        self.assertEqual(result['gift']['checkedAt'], old['gift']['checkedAt'])
        self.assertTrue(result['gift']['checkFailed'])
        self.assertNotIn('checkFailed', old['gift'])

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

if __name__ == '__main__':
    unittest.main()
