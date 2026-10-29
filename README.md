# Дошка контрактів

Публічний список бажань на GitHub Pages. Головна сторінка — вступний екран; кнопка «Зайти в матрицю» відкриває `board.html`, де відвідувачі можуть шукати й фільтрувати записи, переглядати досьє та переходити за посиланнями на товари. Сайт статичний: окремої адмінки й кнопки редагування на сторінці немає.

## Структура репозиторію

```
/
├─ index.html, board.html     сторінки (лишаються в корені, щоб URL не змінились)
├─ assets/                    favicon.svg, apple-touch-icon.png, og.png
├─ css/                       style.css, theme.css, booking.css
├─ js/                        rain.js, transition.js, birthday.js, app.js, booking.js
│                             (+ supabase-config.js — генерується в CI, у git не комітиться)
├─ data/wishes.json           список бажань
├─ supabase/                  schema.sql, config.example.js
└─ .github/workflows/         deploy.yml
```

## Як оновити список

Власник репозиторію відкриває `data/wishes.json` у GitHub, додає або редагує запис і комітить зміну до гілки, з якої публікується GitHub Pages. Нові картки з’являться після завершення публікації.

Приклад картки:

```json
{
  "id": "steam-deck",
  "title": "Steam Deck",
  "description": "Портативна ігрова консоль",
  "image": "https://example.com/steam-deck.jpg",
  "originalUrl": "https://example.com/product",
  "localUrl": "https://hotline.ua/example-product/",
  "priority": "want"
}
```

Кожна картка має мати унікальний `id`, назву `title`, пряме посилання на зображення `image` і пріоритет `priority`. Додавай `originalUrl` для сайту виробника та `localUrl` для локального продавця; для пошуку локальної ціни спершу перевір Hotline. `description`, `originalUrl` і `localUrl` можна пропустити, якщо для них немає даних. Пріоритети в JSON: `want`, `nice`, `unsure`.

Публічні відвідувачі не можуть редагувати репозиторій через сайт. Доступ до змін визначають права GitHub на репозиторій і гілку публікації.

## Публікація

У GitHub відкрий **Settings → Pages** і вибери **Source → GitHub Actions**. Workflow `.github/workflows/deploy.yml` збирає `dist/` з `index.html`, `board.html`, `css/`, `js/`, `assets/` та `data/` і деплоїть його.

## Анімації та доступність

Дошка має анімований цифровий дощ, прокручуваний рядок і неонові ефекти. Анімації вимикаються або спрощуються, коли система запитує зменшення руху.

## Бронювання контрактів (Supabase)

Гості можуть закріплювати (бронювати) за собою контракти на подарунки, щоб інші відвідувачі бачили, що подарунок уже обрано, або перемикати фільтр «Тільки вільні».

### Як налаштувати Supabase без збереження ключів у репозиторії:

1. Зареєструйся на [supabase.com](https://supabase.com) і створи новий безкоштовний проект.
2. У меню зліва відкрий **SQL Editor**, створи новий запит («New query»), скопіюй вміст файлу `supabase/schema.sql` і натисни **Run**. Це створить:
   - таблицю `reservations`;
   - правила безпеки Row Level Security (RLS);
   - безпечну функцію скасування за кодом скасування;
   - Realtime-підписку для синхронізації в реальному часі без перезавантаження сторінки.
3. Перейди в **Project Settings → API** (або Data API) і скопіюй:
   - **Project URL**
   - **anon / public** API Key
4. Додай секрети у свій GitHub-репозиторій:
   - Відкрий репозиторій на GitHub → **Settings → Secrets and variables → Actions**.
   - Натисни **New repository secret** і створи:
     - `SUPABASE_URL` — встав свій Project URL.
     - `SUPABASE_ANON_KEY` — встав свій anon public key.
5. Увімкни деплой через Actions:
   - У GitHub відкрий **Settings → Pages**.
   - У полі **Build and deployment → Source** вибери **GitHub Actions**.
6. При кожному пуші до гілки `main` GitHub Action (`.github/workflows/deploy.yml`) автоматично підставить секрети у файл `js/supabase-config.js` під час збірки. У відкритому репозиторії ключів не буде!

#### Локальна розробка:
Для локального тестування скопіюй `supabase/config.example.js` у `js/supabase-config.js` (цей файл у `.gitignore` і не потрапить у git) і вкажи ключі там, або нічого не вказуй — тоді сайт автоматично працюватиме в локальному демо-режимі через `localStorage`.