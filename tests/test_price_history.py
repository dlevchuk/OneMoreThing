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

    def test_flat_stretch_keeps_first_and_latest_point_only(self):
        history = {}
        for hour in ('00', '06', '12', '18'):
            history = update_history(history, {'one': {**POINT, 'checkedAt': f'2026-11-16T{hour}:00:00Z'}})
        self.assertEqual([p['checkedAt'] for p in history['one']],
                         ['2026-11-16T00:00:00Z', '2026-11-16T18:00:00Z'])
        # A real change starts a new point and is never merged into the flat stretch.
        changed = update_history(history, {'one': {**POINT, 'price': 90, 'checkedAt': '2026-11-17T00:00:00Z'}})
        self.assertEqual([p['price'] for p in changed['one']], [100, 100, 90])
        # Re-exporting the same snapshot stays idempotent.
        self.assertEqual(update_history(changed, {'one': {**POINT, 'price': 90, 'checkedAt': '2026-11-17T00:00:00Z'}}), changed)

if __name__ == '__main__':
    unittest.main()
