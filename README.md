# MAESTRO

Сайт, где можно выбрать незаконченную картину великого мастера, дорисовать её и попросить ИИ переписать рисунок в стиле художника.

- **Сайт** — статический, живёт на GitHub Pages: `https://kingeorgethe1.github.io/maestro/`.
- **Бэкенд** — Cloudflare Worker (папка `worker/`): хранит ключ OpenAI в секрете и вызывает генерацию.
- **Подключено:** бэкенд `https://maestro-api.maestro-art.workers.dev` (модель gpt-image-1.5, качество medium, лимиты 10 генераций в сутки на адрес и 200 на сайт).
- Если в `config.js` сделать `apiUrl` пустым, сайт перейдёт в **демо-режим**: весь путь проходится, результат имитируется в браузере.

## Что где лежит

```
index.html, config.js          страница и адрес бэкенда
assets/js/catalog.js           каталог: 30 работ, фильтры (сюда же добавлять работы 31–50)
assets/js/i18n.js              тексты интерфейса EN / RU
assets/js/app.js               экраны: главная, каталог, карточка, редактор, результат, мои работы
assets/js/editor.js            рисование: инструменты, отмена/повтор, зум, рисование за краем картины
assets/js/hero.js              анимация главной
assets/js/api.js               запрос к бэкенду (или демо-режим)
assets/css/styles.css          стиль по макетам Figma
assets/fonts/                  сюда положить BIPs.woff2 (или .woff/.otf/.ttf)
paintings/                     изображения картин ID.jpg, credits.json, REPORT.md
scripts/fetch-images.mjs       докачивает картины с Wikimedia Commons
worker/worker.js               бэкенд для Cloudflare
.github/workflows/deploy.yml   автоматическая публикация
```

## Шаг 1. Сайт на GitHub Pages (≈10 минут)

1. Войдите на github.com → **New repository** → имя `maestro` → **Public** → **Create repository**.
2. Загрузите файлы. Проще всего через приложение **GitHub Desktop**: Clone репозитория → скопируйте в папку всё содержимое архива (включая скрытую папку `.github`) → Commit → Push.
   Через браузер (**Add file → Upload files**) тоже можно, но папку `.github` браузер может пропустить. Тогда создайте файл вручную: **Add file → Create new file**, имя `.github/workflows/deploy.yml`, вставьте содержимое из архива.
3. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Откройте вкладку **Actions** — через 1–2 минуты публикация завершится, адрес появится в **Settings → Pages**.
5. При первой публикации робот сам скачает картины с Wikimedia Commons и сохранит их в `paintings/`. **Откройте `paintings/REPORT.md` и проверьте каждую строку**: поиск автоматический, может попасться не та картина. Неверную замените своим файлом с тем же именем (`07.jpg` и т. д.).

## Шаг 2. OpenAI

1. platform.openai.com → **Billing**: пополните баланс и задайте месячный лимит расходов (**Limits**), чтобы не было сюрпризов.
2. Для моделей gpt-image OpenAI может попросить подтвердить организацию (**Settings → Organization → Verify**).
3. **API keys → Create new secret key**. Ключ никому не пересылайте — он понадобится только на шаге 3.

## Обновить бэкенд из командной строки

Настройки — в `worker/wrangler.toml` (адрес сайта, модель, качество, лимиты, KV `LIMITS`).

```
cd worker
npx wrangler@4 login                       # один раз
npx wrangler@4 deploy                      # опубликовать изменения worker.js / wrangler.toml
npx wrangler@4 secret put OPENAI_API_KEY   # сменить ключ (вставить при запросе)
npx wrangler@4 tail                        # смотреть логи запросов
```

Проверка: `https://maestro-api.maestro-art.workers.dev/health` → `{"ok":true,...,"limits":true}`.

## Шаг 3. Бэкенд на Cloudflare Workers (≈10 минут)

1. dash.cloudflare.com → **Workers & Pages → Create → Create Worker** → имя `maestro-api` → **Deploy**.
2. **Edit code** → удалите пример, вставьте содержимое `worker/worker.js` → **Deploy**.
3. **Settings → Variables and Secrets**:
   - `OPENAI_API_KEY` — тип **Secret**, значение — ваш ключ OpenAI;
   - `ALLOWED_ORIGINS` — `https://ВАШ-ЛОГИН.github.io` (без `/maestro` на конце);
   - по желанию: `MODEL` (по умолчанию `gpt-image-1.5`), `QUALITY` (`low`/`medium`/`high`), `LIMIT_PER_IP` (10), `LIMIT_TOTAL` (200).
4. Лимиты: **Storage & Databases → KV → Create** (имя `maestro-limits`), затем в воркере **Settings → Bindings → Add → KV namespace**, имя переменной `LIMITS`.
5. Проверьте: откройте `https://maestro-api.ВАШ-ПОДДОМЕН.workers.dev/health` — должно быть `{"ok":true,...}`.

## Шаг 4. Связать сайт и бэкенд

В `config.js` впишите адрес воркера и сохраните изменения в репозиторий:

```js
window.MAESTRO_CONFIG = { apiUrl: 'https://maestro-api.ВАШ-ПОДДОМЕН.workers.dev' };
```

Через минуту сайт пересоберётся, демо-пометка в редакторе исчезнет, генерация пойдёт через OpenAI.

## Шрифт BIPs

Файл шрифта лежит в `assets/fonts/BIPs.ttf`. Убедитесь, что лицензия шрифта разрешает использование на сайте.

## Как добавить работы 31–50

В `assets/js/catalog.js` скопируйте любую запись и заполните поля. Значения фильтров — только из списков в начале файла (`FILTERS`). Изображение положите как `paintings/ID.jpg` или заполните поле `commons` — робот найдёт картинку сам.

## Что сделано как заглушка

- «Войти», аккаунты — показывают подсказку «будет доступно позже».
- «Мои работы» и черновики хранятся на устройстве (IndexedDB), без синхронизации между устройствами.
- «Скопировать ссылку» копирует ссылку на карточку картины, а не на конкретный результат: для ссылок на результаты нужно облачное хранилище.
