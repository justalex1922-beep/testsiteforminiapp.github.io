# Vibe Tap — Telegram Mini App

Это Telegram Mini App (WebApp) в стиле tap-to-earn:

- Главная: тап по большой кнопке (+1 поинт)
- Лидерборд: реальные пользователи из БД, топ‑3 с подсветкой
- Рефералы: правильная ссылка на вашего бота, начисление бонуса
- Кошелек: подключение TON через TonConnect UI
- Глобальный лимит майнинга: после исчерпания — блокировка и переход в ч/б тему
- Вибрация (haptic) на все кнопки

## Быстрый старт (локально)

1) Установите Node.js LTS.

2) В корне проекта:

```bash
npm install
```

3) Создайте `.env` на базе `.env.example` и заполните:

- `BOT_TOKEN` — токен от BotFather
- `BOT_USERNAME` — username бота без `@`
- `WEBAPP_URL` — ваш публичный URL (для деплоя), локально можно оставить пустым

4) Запуск:

```bash
npm run dev
```

Откройте `http://localhost:8080` (фронтенд + API работают на одном адресе).

## Деплой

Рекомендуемая схема:

- Деплой `server.js` (Express) на хостинг (Render/Fly.io/VPS) с HTTPS.
- Этот же сервер раздает статические файлы (`index.html`, `styles.css`, `app.js`) и API (`/api/*`).

После деплоя:

1) В BotFather укажите URL вашего приложения в `Menu Button` (Web App).
2) Создайте `tonconnect-manifest.json` на вашем домене и пропишите URL в `app.js`.

