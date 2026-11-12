import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const wishes = JSON.parse(readFileSync(new URL('data/wishes.json', root), 'utf8'));
const ids = wishes.map(wish => wish.id);
if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))) {
  throw new Error('Wishlist IDs must be unique, nonempty and valid for reserve_gift');
}
const path = new URL('supabase/schema.sql', root);
const schema = readFileSync(path, 'utf8');
const start = '-- BEGIN GENERATED GIFT CATALOG';
const end = '-- END GENERATED GIFT CATALOG';
if (!schema.includes(start) || !schema.includes(end)) throw new Error('SQL catalog markers are missing');
const block = `${start}\nupdate public.gift_catalog set active = false;\ninsert into public.gift_catalog (wish_id, active) values\n${ids.map(id => `  ('${id}', true)`).join(',\n')}\non conflict (wish_id) do update set active = excluded.active;\n${end}`;
const next = schema.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
if (process.argv.includes('--check')) {
  if (next !== schema) throw new Error('Run npm run catalog, then apply supabase/schema.sql');
} else {
  writeFileSync(path, next);
}
