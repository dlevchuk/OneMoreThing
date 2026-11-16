import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from monitoring import marker, desired_rules
spec = importlib.util.spec_from_file_location('audit_monitors', Path(__file__).parents[1] / 'scripts/audit-monitors.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class AuditTest(unittest.TestCase):
    def test_only_failed_owned_monitors_deleted_and_suppressed(self):
        wishes = [{'id': name, 'title': name, 'originalUrl': 'https://example.com/' + name} for name in ['bad', 'pending', 'manual']]
        watches = {w['id']: {'url': w['originalUrl'], 'title': marker(w['id'], w['originalUrl']) + ' | ' + w['title']} for w in wishes}
        watches['manual']['title'] = 'Personal watch'
        calls = []
        def api(path, text=False, method='GET'):
            calls.append((path, method))
            if method == 'DELETE': return None
            if path == 'watch': return watches
            if path == 'watch/bad': return {**watches['bad'], 'last_checked': 1700000000}
            if path == 'watch/pending': return {**watches['pending'], 'last_checked': 0}
            if text: return '<html>No structured product</html>'
            self.fail(path)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir(); (root / 'config').mkdir()
            (root / 'data/wishes.json').write_text(json.dumps(wishes))
            for name in ['price-watches', 'shop-profiles']:
                (root / f'config/{name}.json').write_text('{}')
            report = m.audit(root, api, prune=True)
            self.assertEqual(report['bad'], 'deleted:no_unique_product')
            self.assertEqual(report['pending'], 'pending')
            self.assertEqual(report['manual'], 'not_owned_or_ambiguous')
            self.assertEqual([path for path, method in calls if method == 'DELETE'], ['watch/bad'])
            disabled = json.loads((root / 'config/monitoring-disabled.json').read_text())
            self.assertNotIn('bad', desired_rules(wishes, {}, {}, disabled))
            updated = [{**wishes[0], 'originalUrl': 'https://example.com/fixed'}]
            self.assertIn('bad', desired_rules(updated, {}, {}, disabled))

if __name__ == '__main__':
    unittest.main()
