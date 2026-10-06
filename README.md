# irk.name

Справочник знаменитых имён Иркутска — людей, связанных с городом: уроженцев, жителей, учёных, писателей, артистов, спортсменов, декабристов, меценатов, градоначальников.

Сайт: <https://irk.name> · Стек: [Astro](https://astro.build) (статический сайт), TypeScript (strict), Content Collections + zod.

## Команды

| Команда | Действие |
| --- | --- |
| `npm install` | установить зависимости |
| `npm run dev` | dev-сервер, <http://localhost:4321> |
| `npm run build` | собрать статический сайт в `dist/` |
| `npm run preview` | предпросмотр собранного сайта |
| `npm run check` | проверка типов и схемы контента (`astro check`) |
| `npm test` | тесты скриптов (`scripts/*.test.mjs`, без сети) |

Нужен Node.js 20+ (проверено на 22).

## Админка

Редактирование записей через браузер: `https://irk.name/admin` (пароль). Код — `admin/`, настройка — [DEPLOY.md](DEPLOY.md#админка-admin). Локально: `cd admin && npm i && npm run build`, затем запуск с `ADMIN_STORE=fs` (см. `admin/src/config.ts`).

## Как добавить персону

Один файл на персону: `src/content/persons/<slug>.md`, где `slug` — транслит имени (`grigoriy-shelikhov.md`). Схема описана в `src/content.config.ts`, справочники сфер/эпох/типов связи — в `src/lib/taxonomy.ts`. Пример:

```md
---
name: "Имя Фамилия"
birthYear: 1900
deathYear: 1980
spheres: ["pisatel"]        # ключи из taxonomy.ts
era: xx                     # xvii … xxi
summary: "Одна-две строки (до 300 символов)."
connection: ["life"]        # birth | life | work | exile | visit
connectionNote: "Пояснение связи с Иркутском."
places:
  - name: "Иркутск"
    lat: 52.2897
    lon: 104.2806
sources:                    # минимум один источник
  - title: "Название"
    url: "https://…"
status: needs-check         # verified — только после сверки по источникам
archived: true              # необязательно: скрыть с сайта (видно только в админке)
---
Текст биографии (Markdown).
```

## Правила данных

- Только достоверные сведения со ссылками на источники. Не уверены — `status: needs-check`; `verified` ставится только после сверки.
- О современниках — только публичные общеизвестные биографические факты.
- Фото — только со свободной лицензией (Wikimedia Commons и т. п.): заполните `photo` (`key` в бакете, `alt`, автор, лицензия, ссылка на источник). Иначе без фото.

## SEO

`site: 'https://irk.name'`, sitemap (`@astrojs/sitemap`), `robots.txt`, Open Graph, канонические URL, `lang="ru"`, JSON-LD `Person` на странице персоны.

## Хостинг

Собственный VPS: Docker + Traefik, домен irk.name, картинки — S3 Beget через CDN Beget на `cdn.irk.name`. Подробности — в [DEPLOY.md](DEPLOY.md); поисковая оптимизация и регистрация в вебмастерских — в [SEO.md](SEO.md).

## TODO

- [ ] Сверить все записи по источникам и перевести в `verified`.
- [ ] Карта мест (Leaflet + OpenStreetMap) — поля `places[].lat/lon` уже в схеме.
- [ ] Фото с Wikimedia Commons (с атрибуцией): манифест `data/commons-photos.json`, скрипт `scripts/fetch-commons.mjs`, порядок — DEPLOY.md, «Фото и гербы».
- [ ] Расширение базы: спортсмены, артисты, градоначальники, меценаты.
- [ ] Выкатить на VPS по DEPLOY.md и подключить DNS.
- [ ] Автодеплой (GitHub Actions) — обсудить отдельно.

Скриншоты: `docs/screenshots/`.
