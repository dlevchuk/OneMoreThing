# ✦ OneMoreThing — персональний вішліст

Публічний вішліст на GitHub Pages. Відвідувачі можуть переглядати й фільтрувати картки; список береться з `data/wishes.json`.

## Додавання та редагування карток

GitHub Pages не має сервера, який міг би перевірити особу автора змін. Тому сайт не зберігає картки в браузері й не містить секретних токенів: кнопка «Редагувати список» веде до редактора JSON у GitHub. GitHub дозволить записати зміни лише обліковим записам із правами write на репозиторій. Щоб змінювати список тільки ви, не надавайте іншим користувачам write-доступ.

Додавайте картки як об'єкти масиву `data/wishes.json`:

```json
[
  {
    "id": "steam-deck",
    "title": "Steam Deck",
    "description": "Портативна ігрова консоль",
    "image": "https://example.com/steam-deck.jpg",
    "originalUrl": "https://example.com/product",
    "localUrl": "https://local-market.example/product",
    "priority": "want"
  }
]
```

`image`, `originalUrl`, `localUrl` і `description` необов'язкові. Кнопки посилань показуються лише для заповнених полів. `priority`: `want`, `nice` або `unsure`. Після збереження змін GitHub Pages оновить сайт.

## Анімації та доступність

Картки плавно з'являються з невеликою затримкою, зображення збільшуються при наведенні, а на тлі є повільний декоративний градієнт. Увімкнено підтримку `prefers-reduced-motion`.

## Публікація

GitHub Pages розгортає вміст кореня гілки `main`: **Settings → Pages → Deploy from a branch → main / root**.
