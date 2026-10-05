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
mkdir -p /var/www/irk-name && cd /var/www/irk-name   # путь по конвенции сервера
git clone https://github.com/tulubyev/irk-name.git .
cp .env.example .env
$EDITOR .env
```

Значения по умолчанию уже соответствуют серверу (см. `tulubyev/vps-server-infra`: Traefik v2.11, сеть `traefik-public`, entrypoints `web`/`websecure`, certresolver `letsencrypt`, глобальный редирект http→https). Менять нужно только S3:

| Переменная | По умолчанию | Что это |
| --- | --- | --- |
| `TRAEFIK_NETWORK` | `traefik-public` | внешняя docker-сеть Traefik (уже есть на VPS) |
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

## Админка `/admin`

Страница `https://irk.name/admin` с паролем: список всех записей (включая архив), поиск, редактирование, создание новых, перенос в архив и обратно, отметка «проверено». Отдельный контейнер `admin` (код в `admin/`), Traefik направляет туда всё, что начинается с `/admin`.

**Где хранятся данные.** Базы данных нет: источник истины — Markdown-файлы в `src/content/persons/`. Каждое сохранение в админке — коммит в ветку `main` через GitHub API (с проверкой, что запись не изменили параллельно). Перед сохранением запись проверяется той же схемой, что и при сборке сайта, поэтому админка не может «сломать» сборку. История всех правок и откат — в git.

**Архив.** Запись с `archived: true` не публикуется на сайте, но видна в админке. Репозиторий публичный: файлы архивных записей по-прежнему видны на GitHub.

### Включение

1. **Токен GitHub** (только для записи в этот репозиторий): GitHub → Settings → Developer settings → Personal access tokens → *Fine-grained tokens* → Generate. Repository access: *Only select repositories* → `tulubyev/irk-name`. Permissions → Repository → **Contents: Read and write**. Срок действия — на ваше усмотрение (потом обновить в `.env`).
2. **Хэш пароля** (сам пароль нигде не сохраняется; минимум 12 символов):
   ```bash
   cd /var/www/irk-name
   docker compose --profile admin build admin
   docker compose --profile admin run --rm --no-deps admin node hash-password.mjs
   ```
   (или локально, если есть Node.js: `node admin/hash-password.mjs`).
3. В `.env` на сервере (`chmod 600 .env`):
   ```
   COMPOSE_PROFILES=admin
   ADMIN_PASSWORD_HASH=scrypt:16384:8:1:...      # строка из шага 2
   ADMIN_SESSION_SECRET=...                       # openssl rand -hex 32
   GITHUB_TOKEN=github_pat_...                    # из шага 1
   ```
4. `docker compose up -d --build` и откройте `https://irk.name/admin`.

Смена пароля: сгенерируйте новый хэш, замените в `.env`, `docker compose up -d admin` — все открытые сессии завершатся.

**Защита:** вход только по паролю (хэш scrypt), сессия в cookie `HttpOnly; Secure; SameSite=Strict` на 12 часов, 5 неудачных попыток — блокировка IP на 15 минут, проверка источника всех POST-запросов (CSRF), `noindex`. Неудачные входы пишутся в лог: `docker compose logs admin`.

### Автодеплой (чтобы правки из админки сами попадали на сайт)

Без автодеплоя правки из админки сохраняются в репозиторий, а на сайт попадают после `bash deploy.sh` на сервере. С автодеплоем это делает GitHub Actions (`.github/workflows/deploy.yml`) после каждого обновления `main`: сначала проверка и сборка, затем вход на сервер по SSH-ключу, который может выполнить только `deploy.sh` (так же устроен деплой forestwatch).

1. На сервере создайте ключ и разрешите ему только деплой:
   ```bash
   ssh-keygen -t ed25519 -N '' -C 'github-actions-deploy@irk-name' -f ~/irk-name-deploy
   echo "command=\"cd /var/www/irk-name && bash deploy.sh\",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding $(cat ~/irk-name-deploy.pub)" >> ~/.ssh/authorized_keys
   ssh-keyscan -t ed25519 90.156.168.149
   ```
   Пользователь должен иметь право на `docker compose` (группа `docker`) и на `git` в `/var/www/irk-name`.
2. В GitHub → репозиторий → Settings → Secrets and variables → Actions добавьте секреты:
   `DEPLOY_SSH_KEY` (содержимое `~/irk-name-deploy`), `DEPLOY_HOST` (`90.156.168.149`), `DEPLOY_USER` (пользователь на сервере), `DEPLOY_KNOWN_HOSTS` (вывод `ssh-keyscan`).
3. Удалите приватный ключ с сервера: `rm ~/irk-name-deploy`.

Пока секреты не заданы, шаг деплоя в Actions просто пропускается. Отозвать доступ: удалить строку из `authorized_keys` и секрет `DEPLOY_SSH_KEY`.
