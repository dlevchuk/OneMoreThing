---
name: onemorething
description: Контекст, архітектура й правила для репозиторію OneMoreThing ("Дошка контрактів") — статичний cyberpunk-вішліст на GitHub Pages + Supabase (бронювання подарунків, вхід власника, черга імпорту, моніторинг цін через changedetection.io). Обов'язково використовуй цей скіл, коли користувач редагує, дебажить, рев'юїть або розширює будь-що в цьому проєкті: data/wishes.json, js/*.js, css/*.css, index/board/owner.html, supabase/schema.sql, Edge Functions (sync-catalog, wish-import-queue), scripts/*.py|mjs, .github/workflows, тести, CSP, ціни, бронювання, owner-кабінет, "дошка", "контракти", "wishlist", "whishlist", "OneMoreThing" — навіть якщо він не згадує назву проєкту прямо.
---

# OneMoreThing — Дошка контрактів

Публічний список бажань українською, у Matrix/cyberpunk-стилі. Гості бачать картки, ціни й можуть бронювати подарунки. Власник (один) відмічає виконані й додає нові бажання.

## Правила роботи з користувачем (Dmytro)

- **Завжди віддавай повні версії файлів**, які треба змінити. Не diff і не фрагменти.
- Відповіді короткі, неформальні, без води. Співрозмовник — експерт у DevOps/Linux/AWS, базові речі не пояснюй.
- Якщо задум неясний або бракує файлу/прикладу даних — спершу спитай.
- UI-тексти й коментарі в коді — українською (як у решті репозиторію). Лексика: "контракти", "матриця", "ICE", "оператор".

## Стек

| Шар | Що використовуємо |
|---|---|
| Фронтенд | Статичний HTML + vanilla JS + CSS. **Без бандлера, фреймворків і build-кроку**, окрім копіювання в `dist/` |
| Хостинг | GitHub Pages через Actions (`deploy.yml`) |
| БД / Auth / Realtime | Supabase: Postgres + RLS + RPC (`security definer`), Auth (magic link, PKCE), Realtime |
| Серверна логіка | Supabase Edge Functions (Deno + `jose`): `sync-catalog`, `wish-import-queue`. `verify_jwt = false`, бо перевіряють GitHub OIDC самі |
| Автоматизація | GitHub Actions: `deploy.yml`, `add-wish.yml` (cron кожні ~5 хв + workflow_run) |
| Моніторинг цін | changedetection.io на Raspberry Pi 4 + Python-скрипти (лише stdlib) |
| Тести | `node --test tests/*.test.mjs` + `python3 -m unittest`, SQL-сценарії для ізольованої БД. Усе разом: `npm test` |
| Supabase JS | CDN jsdelivr, **версія зафіксована + SRI** (`board.html`, `owner.html`) |

## Структура

```
index.html board.html owner.html   сторінки (корінь, щоб URL не змінились)
css/ js/ assets/                   фронтенд (js/supabase-config.js генерується в CI, у .gitignore)
data/                              wishes.json (джерело правди), prices.json, price-history.json, monitoring-status.json
config/                            shop-profiles.json, price-watches.json, monitoring-disabled.json, catalog-status.json
scripts/                           add-wish.py, sync-prices.py, monitoring.py, price_history.py, audit-monitors.py, *.mjs
supabase/                          schema.sql (ідемпотентна), config.toml, functions/*
tests/                             JS, Python, SQL
.github/workflows/                 deploy.yml, add-wish.yml
```

Скіл лежить у `.claude/skills/onemorething/` і **не потрапляє на сайт**: `deploy.yml` копіює в `dist/` лише `index/board/owner.html`, `css js assets data` (+ `img`).

## Архітектурні рішення (не ламай без явної причини)

1. **`data/wishes.json` — єдине джерело правди.** `gift_catalog` у БД лише віддзеркалює його: Edge Function `sync-catalog` читає файл з **незмінного коміту** (`claims.sha`), а не з тіла запиту. ID: `^[A-Za-z0-9_-]{1,100}$`, унікальні, 1–500 штук.
2. **Застарілий деплой нічого не публікує.** Крок `Synchronize live booking catalog` ставить `superseded=true`, і build/upload/deploy пропускаються (не помилка). Нові кроки публікації мають мати `if: steps.catalog.outputs.superseded != 'true'`.
3. **Бронювання тільки через RPC** `reserve_gift` / `cancel_reservation`. Прямих insert/update/delete для anon немає. Код скасування генерується в браузері, на сервері лише `sha256`. Rate-limit через `reservation_attempts` + advisory lock `(1869440817, 1)`. Старі 4-значні PIN працюють.
4. **Власник = рядок у `private.site_owners`.** Перевірка завжди на сервері через `auth.uid()` (`is_site_owner()`), не email і не user metadata. `OwnerManager.isOwner` у браузері — лише UX. `shouldCreateUser: false`, PKCE.
5. **Черга імпорту** (`private.wish_import_jobs`): браузер ходить тільки в owner-RPC; worker (Actions) — тільки в Edge Function з GitHub OIDC. Lease прив'язаний до `run_id` із підписаного токена, 20 хв, максимум 3 спроби.
6. **Edge Function `policy.mjs` тримає довіру жорстко**: repository, repository_id, owner_id, `refs/heads/main`, точний workflow, environment. Для форку це треба змінити вручну (README).
7. **Ціни: лише `originalUrl`.** `localUrl` не моніториться. Парсер (`monitoring.Page`) приймає рівно один Product, точну ціну, одну валюту. Діапазони, кілька варіантів, довільні числа зі сторінки → `ValueError` з відомою причиною (`SOURCE_REASONS`). Валюта показується як у джерелі, без конвертації; `taxIncluded: false` → "без ПДВ".
8. **Watches у changedetection:** власні мають ім'я `OneMoreThing/<id>/<hash>`. Чужі й ручні **не чіпаємо**. Зайві власні ставимо на паузу, не видаляємо (виняток: виконані подарунки та `audit-monitors.py --prune`). Якщо публічний статус виконаних недоступний — **fail closed**, нічого не змінюємо.
9. **Історія цін:** лише реальні успішні перевірки; плоска ділянка стискається до першої й останньої точки; ніколи не змішуємо різні url/валюту/ПДВ; ліміт 730 точок.
10. **Фронтенд:** усе, що прийшло з JSON/БД, — недовірене. Екрануємо через `escHtml`, URL через `safeUrl`. Один делегований listener на grid; `renderDetails` порівнює markup і не перемальовує зайве; `fetchReservations` серіалізований; незмінний snapshot не викликає notify; помилка мережі зберігає попередній стан.
11. **CSP без inline:** ні `<script>` з кодом, ні `style=""`/`<style>`. Стилі — у `css/*.css`, динамічні значення через CSSOM (`el.style.setProperty`). CSP різна на сторінках: `index.html` без jsdelivr і без Supabase; `board.html`/`owner.html` — з ними. Новий зовнішній хост → оновити CSP **у кожній** потрібній сторінці.
12. **Секрети:** service-role ключ живе тільки в Edge Functions. У браузері й CI лише `SUPABASE_URL` + `SUPABASE_ANON_KEY`.
13. **Анімації** (rain, transition, glitch) мають зупинятись при `prefers-reduced-motion`, прихованій вкладці й відкритому `<dialog>`.

## Коли викликати цей скіл

- Будь-яка зміна файлів із таблиці структури вище.
- Питання "чому бронювання/імпорт/ціна/деплой не працює" у цьому проєкті.
- Рев'ю PR/діфу, нова фіча (нова вкладка, новий RPC, новий магазин, новий workflow).
- Додавання бажання, профілю магазину, зміна пріоритетів чи тексту UI.

Не потрібен для загальних питань про Supabase/GitHub Actions, які не стосуються цього репозиторію.

## Приклади: добре / погано

### Рендер даних

```js
// ПОГАНО: XSS через title/url з JSON або БД
card.innerHTML = `<a href="${wish.originalUrl}">${wish.title}</a>`;

// ДОБРЕ
const url = safeUrl(wish.originalUrl);
card.innerHTML = url
  ? `<a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">${escHtml(wish.title)}</a>`
  : escHtml(wish.title);
```

### Динамічні стилі (CSP)

```js
// ПОГАНО: заблокує CSP
el.setAttribute('style', `--tilt:${deg}deg`);

// ДОБРЕ
el.style.setProperty('--tilt', `${deg}deg`);
```

### Запис у БД з браузера

```js
// ПОГАНО: прямий insert, RLS його й так заборонить
await client.from('reservations').insert({ wish_id, reserved_by: name });

// ДОБРЕ: тільки RPC, токен генеруємо локально
await client.rpc('reserve_gift', { p_wish_id: wishId, p_name: name, p_token: generateToken() });
```

### Перевірка власника

```js
// ПОГАНО: довіра до клієнта
if (localStorage.getItem('isOwner') || session.user.email === 'me@example.com') showAdmin();

// ДОБРЕ: сервер вирішує, клієнт лише відображає
const { data } = await client.rpc('is_site_owner');
setOwner(data === true);
```

### Нова SQL-функція

```sql
-- ПОГАНО: security definer без search_path, доступна всім
create function public.do_thing(p text) returns void language plpgsql security definer as $$ ... $$;

-- ДОБРЕ: ідемпотентно, закритий search_path, явні права, перевірка власника
create or replace function public.do_thing(p text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_site_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  ...
end;
$$;
revoke all on function public.do_thing(text) from public, anon;
grant execute on function public.do_thing(text) to authenticated;
```

Схема має лишатись **повторно запускною** (`if not exists`, `create or replace`, `drop policy if exists`).

### Edge Function

```js
// ПОГАНО: ID з тіла запиту
const { ids } = await request.json();
await rpc('sync_gift_catalog', { p_ids: ids });

// ДОБРЕ: тільки підписані claims + незмінний коміт
claims = await verify(token); authorizeClaims(claims);
const text = await fetcher(`https://raw.githubusercontent.com/${REPOSITORY}/${claims.sha}/data/wishes.json`);
```

### Парсинг ціни

```python
# ПОГАНО: перше число на сторінці, діапазон як "ціна"
price = float(re.search(r'\d[\d\s,.]*', html).group())
price = offer['lowPrice']

# ДОБРЕ: точна ціна з єдиного Product, інакше зрозуміла причина
page = Page(html)
price, stock = page.observation(price_source)   # кидає ValueError('Ambiguous variants or sellers') тощо
```

### Монітори

```python
# ПОГАНО: чіпаємо все, що знайшли
for uuid in watches: api('watch/' + uuid, method='DELETE')

# ДОБРЕ: тільки свої за маркером, чужі ніколи
name = (item.get('title') or '').split(' | ', 1)[0]
if name.startswith(PREFIX): ...   # власний watch
```

### Додавання бажання

```jsonc
// ПОГАНО: дубль id, немає пріоритету, URL без originalUrl для моніторингу
{ "id": "steam deck", "title": "Steam Deck", "localUrl": "https://hotline.ua/..." }

// ДОБРЕ (або через owner.html / scripts/add-wish.py, який сам генерує id)
{
  "id": "steam-deck-oled",
  "title": "Steam Deck OLED",
  "description": "Ігри офлайн...",
  "image": "https://...",
  "originalUrl": "https://shop.example/steam-deck",
  "localUrl": "https://hotline.ua/...",
  "priority": "nice"
}
```

### Тести

```js
// ПОГАНО: змінили логіку, тест не додали; або тест ходить у реальну мережу/БД
// ДОБРЕ: vm-harness з підміненим client/fetch (див. tests/owner.test.mjs, tests/booking.test.mjs),
// Python — FakeAPI (tests/test_monitoring.py). Мережі й секретів у тестах немає.
```

## Чекліст перед тим, як віддати відповідь

1. Змінений файл віддано **повністю**.
2. `npm test` проходить; для нової поведінки є тест (JS або Python, у стилі сусідніх).
3. Нові дані з зовнішнього світу екрановані, URL пройшли `safeUrl` / `public_url`.
4. Немає inline-скриптів і стилів; CSP актуальна на всіх зачеплених сторінках.
5. Нові `<script>`/`<link>` мають `?v=0` (його підміняє `sed` у CI) і `defer`.
6. SQL ідемпотентний, права виставлені явно, перевірки на сервері.
7. Жодних service-role ключів, токенів чи UUID watches у публічних файлах.
8. Якщо змінилась поведінка, яку описує `README.md`, — оновлено й README.
9. Не ламає fail-closed і "ніколи не чіпаємо чужі watches" у моніторингу.

## Відомі пастки

- `js/supabase-config.js` немає в git; локально `npm run setup`. Без ключів `BookingManager` працює в demo-режимі через `localStorage`.
- Статус `completed` у моніторингу береться з публічного `gift_catalog`; зламаний конфіг → синхронізація зупиняється, а не "вважає, що виконаних нема".
- Таблиця `gift_catalog` після чистого `schema.sql` порожня до першого успішного деплою — тоді бронювання дає `invalid_wish`.
- Планові workflow GitHub можуть запізнюватись, тому час обробки імпорту не гарантований.
- `policy.mjs` має захардкоджені ID репозиторію й власника, тести їх теж перевіряють.
