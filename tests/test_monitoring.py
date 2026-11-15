import importlib.util
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from monitoring import Page, desired_rules, reconcile, marker

spec = importlib.util.spec_from_file_location('add_wish', Path(__file__).parents[1] / 'scripts/add-wish.py')
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def html(product):
    return '<script type="application/ld+json">' + json.dumps(product) + '</script>'


PRODUCT = {'@type': 'Product', 'name': 'Test product', 'image': '/photo.jpg', 'offers': {
    '@type': 'Offer', 'price': '1234.50', 'priceCurrency': 'UAH', 'availability': 'https://schema.org/InStock'}}
WISH = {'id': 'one', 'title': 'Test product', 'originalUrl': 'https://shop.example/item'}


class StructuredDataTest(unittest.TestCase):
    def test_metadata_and_price(self):
        page = Page(html({'@graph': [PRODUCT]}))
        self.assertEqual(page.observation(), (1234.5, 'in_stock'))
        self.assertEqual(page.metadata(WISH['originalUrl'])['image'], 'https://shop.example/photo.jpg')

    def test_rejects_foreign_currency_variants_and_aggregates(self):
        products = [{**PRODUCT, 'offers': {**PRODUCT['offers'], 'priceCurrency': ''}},
                    {**PRODUCT, 'offers': [PRODUCT['offers'], {**PRODUCT['offers'], 'price': 2000}]},
                    {**PRODUCT, 'offers': {'@type': 'AggregateOffer', 'lowPrice': 100, 'priceCurrency': 'UAH'}}]
        for product in products:
            with self.subTest(product=product), self.assertRaises(ValueError):
                Page(html(product)).observation()
        with self.assertRaises(ValueError):
            Page(html([PRODUCT, PRODUCT])).observation()

    def test_original_currency_is_preserved(self):
        page = Page(html({**PRODUCT, 'offers': {**PRODUCT['offers'], 'priceCurrency': 'USD'}}))
        self.assertEqual(page.observation(), (1234.5, 'in_stock'))
        self.assertEqual(page.currency(), 'USD')

    def test_import_card_from_url_and_relative_image(self):
        card = importer.make_card(WISH['originalUrl'], html(PRODUCT), 'want')
        self.assertEqual(card['title'], PRODUCT['name'])
        self.assertEqual(card['originalUrl'], WISH['originalUrl'])
        self.assertEqual(card['priority'], 'want')
        self.assertEqual(card['id'], importer.make_card(WISH['originalUrl'], html(PRODUCT))['id'])


class FakeAPI:
    def __init__(self):
        self.watches = {'manual': {'url': 'https://other.example', 'title': 'Personal watch', 'paused': False}}
        self.calls = []
    def __call__(self, path, method='GET', payload=None):
        self.calls.append((path, method, payload))
        if method == 'GET':
            return {key: dict(value) for key, value in self.watches.items()} if path == 'watch' else dict(self.watches[path.split('/')[1]])
        if method == 'POST':
            uuid = 'new-' + str(len(self.watches))
            self.watches[uuid] = dict(payload)
            return {'uuid': uuid}
        if method == 'PUT':
            self.watches[path.split('/')[1]].update(payload)
            return 'OK'
        raise AssertionError('Unexpected API request')


class ReconcileTest(unittest.TestCase):
    def test_create_retry_pause_and_resume_without_touching_manual(self):
        api = FakeAPI()
        rules = desired_rules([WISH], {}, {})
        first, errors = reconcile(rules, api, lambda state: None)
        self.assertFalse(errors)
        uuid = first['one']['watchId']
        reconcile(rules, api, lambda state: None)
        self.assertEqual(len([x for x in api.calls if x[1] == 'POST']), 1)
        reconcile({}, api, lambda state: None)
        self.assertTrue(api.watches[uuid]['paused'])
        self.assertFalse(api.watches['manual']['paused'])
        reconcile(rules, api, lambda state: None)
        self.assertFalse(api.watches[uuid]['paused'])

    def test_existing_manual_url_is_reused_without_modification(self):
        api = FakeAPI()
        api.watches['manual']['url'] = WISH['originalUrl']
        rules, errors = reconcile(desired_rules([WISH], {}, {}), api, lambda state: None)
        self.assertFalse(errors)
        self.assertEqual(rules['one']['watchId'], 'manual')
        self.assertFalse(any(call[1] != 'GET' for call in api.calls))

    def test_url_change_pauses_old_and_creates_new(self):
        api = FakeAPI()
        first, _ = reconcile(desired_rules([WISH], {}, {}), api, lambda state: None)
        old = first['one']['watchId']
        updated = {**WISH, 'originalUrl': 'https://shop.example/new'}
        second, _ = reconcile(desired_rules([updated], {}, {}), api, lambda state: None)
        self.assertNotEqual(old, second['one']['watchId'])
        self.assertTrue(api.watches[old]['paused'])

    def test_recovers_watch_when_create_response_was_lost(self):
        api = FakeAPI()
        api.watches['recovered'] = {'url': WISH['originalUrl'], 'title': marker('one', WISH['originalUrl']) + ' | Test product', 'paused': False}
        rules, _ = reconcile(desired_rules([WISH], {}, {}), api, lambda state: None)
        self.assertEqual(rules['one']['watchId'], 'recovered')
        self.assertFalse(any(call[1] == 'POST' for call in api.calls))

    def test_only_original_source_is_used(self):
        wish = {**WISH, 'localUrl': 'https://local.example/item',
                'monitoring': {'url': 'https://ignored.example'}}
        overrides = {'one': {'url': wish['localUrl'], 'watchId': 'old-local', 'priceRegex': 'old'}}
        rule = desired_rules([wish], overrides, {})['one']
        self.assertEqual(rule['url'], WISH['originalUrl'])
        self.assertNotIn('watchId', rule)
        self.assertNotIn('priceRegex', rule)
        del wish['originalUrl']
        self.assertEqual(desired_rules([wish], overrides, {}), {})

    def test_profiles_overrides_disable_and_invalid_local_urls(self):
        profiles = {'shop.example': {'store': 'Store', 'priceRegex': 'Price: (.*)'}}
        rules = desired_rules([WISH], {}, profiles)
        self.assertEqual(rules['one']['store'], 'Store')
        self.assertIn('priceRegex', rules['one'])
        self.assertEqual(desired_rules([{**WISH, 'monitoring': False}], {}, profiles), {})
        for url in ['http://127.0.0.1', 'file:///etc/passwd', 'http://pi5.tail72e9f.ts.net']:
            with self.assertRaises(ValueError):
                desired_rules([{**WISH, 'originalUrl': url}], {}, {})

    def test_duplicate_marker_requires_review(self):
        api = FakeAPI()
        name = marker('one', WISH['originalUrl'])
        for key in ['a', 'b']:
            api.watches[key] = {'title': name, 'url': WISH['originalUrl'], 'paused': False}
        rules, errors = reconcile(desired_rules([WISH], {}, {}), api, lambda state: None)
        self.assertEqual(errors['one'], 'duplicate_watches')
        self.assertEqual(rules, {})


if __name__ == '__main__':
    unittest.main()
