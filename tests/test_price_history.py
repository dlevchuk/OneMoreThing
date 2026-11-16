import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from price_history import update_history

POINT = dict(price=100, currency='UAH', url='https://source.example/item', checkedAt='2026-11-16T00:00:00Z')

class HistoryTest(unittest.TestCase):
    def test_deduplicates_same_check_and_skips_failed_observations(self):
        first = update_history({}, {'one': POINT})
        self.assertEqual(update_history(first, {'one': POINT}), first)
        self.assertEqual(update_history(first, {'one': {**POINT, 'checkFailed': True, 'price': 200}}), first)
        self.assertEqual(len(update_history(first, {'one': {**POINT, 'checkedAt': '2026-11-16T06:00:00Z'}})['one']), 2)

    def test_retains_currency_source_and_tax_without_mutating_input(self):
        first = update_history({}, {'one': POINT})
        updated = update_history(first, {'one': {**POINT, 'price': 50, 'currency': 'EUR', 'url': 'https://new.example', 'taxIncluded': False}})
        self.assertEqual(len(updated['one']), 2)
        self.assertFalse(updated['one'][1]['taxIncluded'])
        self.assertEqual(len(first['one']), 1)

    def test_bounds_history(self):
        first = update_history({}, {'one': POINT})
        updated = update_history(first, {'one': {**POINT, 'checkedAt': '2026-11-16T06:00:00Z'}}, limit=1)
        self.assertEqual(len(updated['one']), 1)
        self.assertEqual(updated['one'][0]['checkedAt'], '2026-11-16T06:00:00Z')

if __name__ == '__main__':
    unittest.main()
