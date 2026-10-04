# Деплой на VPS (Docker + Traefik)

Сайт — статика (`dist/`), которую отдаёт nginx в контейнере `web`. Картинки лежат в S3-бакете Beget и отдаются через `cdn.irk.name` (контейнер `cdn`, nginx с дисковым кешем). Оба сервиса подключаются к уже работающему Traefik; порты наружу не публикуются.

> Секретов в репозитории нет и быть не должно (репозиторий публичный). Ключи S3 нужны только для загрузки картинок и хранятся в переменных окружения / GitHub Secrets.

## 1. DNS

| Тип | Имя | Значение |
| --- | --- | --- |
| A | `irk.name` | `90.156.168.149` |
| A | `www.irk.name` | `90.156.168.149` |
| A | `cdn.irk.name` | `90.156.168.149` |

`www` автоматически редиректится на `irk.name` (301).

## 2. Настройка

```bash
git clone https://github.com/tulubyev/irk-name.git && cd irk-name
cp .env.example .env
$EDITOR .env
```

Что менять в `.env` под ваш сервер (по умолчанию стоят типовые значения):

| Переменная | По умолчанию | Что это |
| --- | --- | --- |
| `TRAEFIK_NETWORK` | `traefik` | имя внешней docker-сети Traefik (`docker network ls`) |
| `TRAEFIK_ENTRYPOINT_HTTP` | `web` | entrypoint :80 |
| `TRAEFIK_ENTRYPOINT_HTTPS` | `websecure` | entrypoint :443 |
| `TRAEFIK_CERTRESOLVER` | `letsencrypt` | certresolver Let's Encrypt в конфиге Traefik |
| `SITE_HOST`, `CDN_HOST` | `irk.name`, `cdn.irk.name` | домены |
| `PUBLIC_CDN_URL` | `https://cdn.irk.name` | базовый URL картинок (зашивается при сборке) |
| `S3_HOST`, `S3_BUCKET` | — | хост эндпоинта Beget и имя бакета (для прокси `cdn`) |

## 3. Запуск

```bash
docker compose up -d --build
docker compose ps          # оба сервиса должны быть healthy
```

## 4. Обновление

```bash
git pull
docker compose up -d --build
```

## 5. Откат

```bash
git log --oneline          # найти последний рабочий коммит
git checkout <commit>
docker compose up -d --build
```

Либо перед обновлением пометьте текущий образ: `docker tag irk-name-web:latest irk-name-web:prev`, а для отката поменяйте `image:` в compose на `irk-name-web:prev` и выполните `docker compose up -d --no-build`.

## Медиа-хранилище (Beget S3)

1. В панели Beget создайте S3-бакет, включите **публичное чтение** (для картинок). Запишите эндпоинт, регион, имя бакета и создайте ключ доступа.
2. Впишите `S3_ENDPOINT`, `S3_HOST`, `S3_REGION`, `S3_BUCKET` в `.env` (ключи — не сюда).
3. Подготовьте картинки локально в папке `media/` (она в `.gitignore`): для каждой персоны два webp — `persons/<slug>.webp` (1280 px) и `persons/<slug>-640.webp`. Для неизменяемых файлов добавляйте хэш в имя (`<slug>-<8+ hex>.webp`) — они получат `immutable` на год.
4. Загрузите (ключи из окружения):

```bash
export S3_ENDPOINT=… S3_REGION=… S3_BUCKET=… S3_FORCE_PATH_STYLE=true
export S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=…
npm run upload-media -- --dry-run   # посмотреть, что будет загружено
npm run upload-media                # загрузить; повторный запуск пропускает неизменённые файлы
```

5. В карточке персоны укажите `photo.key` (`persons/<slug>.webp`), автора, лицензию и ссылку на источник — они выводятся под фото. Только свободные лицензии.

**Сброс кеша CDN:** кеш nginx лежит в томе `cdn-cache`:

```bash
docker compose stop cdn && docker volume rm irk-name_cdn-cache && docker compose up -d cdn
```

(имя тома смотрите в `docker volume ls`; префикс зависит от имени каталога проекта).

## CI

`.github/workflows/ci.yml` на каждом PR запускает `npm run check`, `npm run build` и `docker build`. Автодеплой не настроен.
