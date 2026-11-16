import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from catalog_status import completed_ids

class CompletionTest(unittest.TestCase):
    def test_reads_only_public_ids_and_trims_header_key(self):
        requests = []
        def opener(request, timeout):
            requests.append(request)
            if isinstance(request, str):
                return io.BytesIO(('window.SUPABASE_CONFIG = ' + json.dumps({'url': 'https://test.supabase.co', 'anonKey': 'public-key\n'}) + ';').encode())
            self.assertEqual(request.get_header('Apikey'), 'public-key')
            self.assertIn('select=wish_id', request.full_url)
            self.assertIn('completed_at=not.is.null', request.full_url)
            self.assertNotIn('completion_note', request.full_url)
            return io.BytesIO(b'[{"wish_id":"done"}]')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'config').mkdir()
            (root / 'config/catalog-status.json').write_text('{"siteUrl":"https://example.com"}')
            self.assertEqual(completed_ids(root, opener), {'done'})
        self.assertEqual(len(requests), 2)

    def test_invalid_public_config_aborts_instead_of_assuming_no_completions(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'config').mkdir()
            (root/'config/catalog-status.json').write_text('{"siteUrl":"https://example.com"}')
            with self.assertRaises(ValueError):
                completed_ids(root, lambda *args, **kwargs: io.BytesIO(b'invalid'))

if __name__ == '__main__':
    unittest.main()
