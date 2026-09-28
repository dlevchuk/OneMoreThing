# ✦ OneMoreThing — Персональний Вішліст

> Статичний сайт для зберігання бажань і мрій. Без серверу, без реєстрації — всі дані у localStorage браузера.

## 🚀 Демо

[🔗 Відкрити сайт](https://dlevchuk.github.io/OneMoreThing/)

## ✨ Функціонал

- **Додавання карток** — назва, опис, посилання, ціна, категорія, пріоритет, емодзі/фото
- **Три категорії** — 🛍️ Хочу / 🌠 Мрію / ✅ Здійснилось
- **Фільтрація** по категоріях
- **Пошук** по назві та опису
- **Редагування і видалення** карток
- **Статистика** — лічильники у hero-секції
- **localStorage** — дані зберігаються між сесіями
- **Демо-дані** при першому відкритті

## 🛠 Технологій

- Vanilla HTML / CSS / JavaScript (без фреймворків)
- Google Fonts (Outfit + Inter)
- CSS: glassmorphism, grid, container queries, `@starting-style`
- Нативний `<dialog>` для модального вікна

## 📦 GitHub Pages

Сайт розгорнутий автоматично через **GitHub Pages** з гілки `main`.

Налаштування: **Settings → Pages → Source: Deploy from a branch → main / root**

## 📁 Структура

```
OneMoreThing/
├── index.html   — розмітка
├── style.css    — стилі
├── app.js       — логіка (CRUD, localStorage, фільтри)
└── README.md
```
