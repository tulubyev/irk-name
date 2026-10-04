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

Нужен Node.js 20+ (проверено на 22).

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
---
Текст биографии (Markdown).
```

## Правила данных

- Только достоверные сведения со ссылками на источники. Не уверены — `status: needs-check`; `verified` ставится только после сверки.
- О современниках — только публичные общеизвестные биографические факты.
- Фото — только со свободной лицензией (Wikimedia Commons и т. п.): заполните `photo` (автор, лицензия, ссылка на источник). Иначе без фото.

## SEO

`site: 'https://irk.name'`, sitemap (`@astrojs/sitemap`), `robots.txt`, Open Graph, канонические URL, `lang="ru"`, JSON-LD `Person` на странице персоны.

## Хостинг

Выход — обычная статика в `dist/`, привязки к платформе нет. Подойдут Vercel или Cloudflare Pages (build: `npm run build`, output: `dist`).

## TODO

- [ ] Сверить все записи по источникам и перевести в `verified`.
- [ ] Карта мест (Leaflet + OpenStreetMap) — поля `places[].lat/lon` уже в схеме.
- [ ] Фото с Wikimedia Commons (с атрибуцией).
- [ ] Расширение базы: спортсмены, артисты, градоначальники, меценаты.
- [ ] Выбор хостинга и подключение домена irk.name.

Скриншоты: `docs/screenshots/`.
