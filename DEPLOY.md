# Деплой на VPS (Docker + Traefik)

Сайт — статика (`dist/`), которую отдаёт nginx в контейнере `web` (и админка `admin`, если включена). Контейнеры подключаются к уже работающему Traefik; порты наружу не публикуются. С 14.11.2026 картинки лежат в `media/` на российском VPS и раздаются nginx-сервисом `media` через `cdn.irk.name`. Актуальное состояние и конфигурация — [docs/HOSTING-RU.md](docs/HOSTING-RU.md).

> Секреты админки и деплоя хранятся в `.env` на сервере (права 600) и GitHub Secrets. Каталог `media/` не входит в git и требует отдельного резервного копирования.

## 1. DNS

| Тип | Имя | Значение |
| --- | --- | --- |
| A | `irk.name` | `141.133.187.90` |
| A | `www.irk.name` | `141.133.187.90` |
| A | `cdn.irk.name` | `141.133.187.90` |

`www` автоматически перенаправляется на `irk.name` (на текущем VPS — 308). Сертификаты всех трёх доменов выпускает Traefik через Let’s Encrypt.

## 2. Настройка

```bash
mkdir -p /var/www/irk-name && cd /var/www/irk-name   # путь по конвенции сервера
git clone https://github.com/tulubyev/irk-name.git .
cp .env.example .env
$EDITOR .env
```

Значения по умолчанию уже соответствуют серверу (см. `tulubyev/vps-server-infra`: сеть `traefik-public`, entrypoints `web`/`websecure`, certresolver `letsencrypt`, глобальный редирект http→https). Менять обычно ничего не нужно:

| Переменная | По умолчанию | Что это |
| --- | --- | --- |
| `TRAEFIK_NETWORK` | `traefik-public` | внешняя docker-сеть Traefik (уже есть на VPS) |
| `TRAEFIK_ENTRYPOINT_HTTP` | `web` | entrypoint :80 |
| `TRAEFIK_ENTRYPOINT_HTTPS` | `websecure` | entrypoint :443 |
| `TRAEFIK_CERTRESOLVER` | `letsencrypt` | certresolver Let's Encrypt в конфиге Traefik |
| `SITE_HOST` | `irk.name` | домен сайта |
| `PUBLIC_CDN_URL` | `https://cdn.irk.name` | базовый URL картинок (зашивается при сборке) |

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

## Медиа-хранилище на VPS

Все фотографии находятся в `/var/www/irk-name/media/` на российском сервере `141.133.187.90`. Контейнер `media` (nginx) читает этот каталог и отдаёт его через `https://cdn.irk.name`. Внешнее объектное хранилище не используется.

Серверный `compose.media.yaml` и его конфигурация приведены в [docs/HOSTING-RU.md](docs/HOSTING-RU.md). В `.env` должны быть:

```dotenv
COMPOSE_FILE=docker-compose.yml:compose.media.yaml
COMPOSE_PROFILES=admin
ADMIN_MEDIA_STORE=fs
PUBLIC_CDN_URL=https://cdn.irk.name
```

`ADMIN_MEDIA_STORE=fs` уже добавлен владельцем на сервере. Чтобы настройка заработала, нужен код с поддержкой локального загрузчика и права записи для контейнера админки (см. «Фото из админки»).

Админка получает `./media:/data/media` с правом записи, nginx — `./media:/usr/share/nginx/html:ro` только для чтения. Карточки персон остаются в GitHub; файлы изображений хранятся на VPS.

Для каждой фотографии подготовлены три WebP-файла: `persons/<имя>.webp` (до 1200 px), `persons/<имя>-640.webp` и `persons/<имя>-160.webp`. Загрузчик админки добавляет хэш в имя: замена фото получает новый URL, старые файлы остаются для отката.

Проверка раздачи:

```bash
cd /var/www/irk-name
docker compose ps media
curl -I https://cdn.irk.name/persons/sergey-trubetskoy.webp
curl -I https://cdn.irk.name/persons/sergey-trubetskoy-160.webp
```

Оба запроса должны возвращать `200` с действительным сертификатом. Сертификат выпускает общий Traefik через Let's Encrypt.

**Резервное копирование:** отдельно сохраняйте `media/`, `.env`, серверный `compose.media.yaml` и том предложений. GitHub содержит ссылки на изображения, но не их файлы. Наличие автоматических бэкапов этих данных пока не подтверждено.

## Фото и гербы

Для автоматического подбора фото используются Wikimedia Commons и свободные лицензии. Снимки из семейных архивов администратор загружает отдельно с указанием автора и условий публикации. Список файлов — `data/commons-photos.json` (`persons`: `slug` → `file` + `alt`; `heraldry`: гербы для шапки). Автор, лицензия и ссылки **не заполняются вручную** — их получает из API Commons скрипт `scripts/fetch-commons.mjs`. Скрипт запускается на сервере (из облачных сред Commons часто недоступен), Node.js 24.

Белый список лицензий: Public domain, PD-*, CC0, CC BY *, CC BY-SA *, Attribution, Free Art License (FAL). Файлы с другой лицензией (NC/ND, GFDL, fair use, без лицензии) скрипт пропускает и печатает списком.

Если на сервере нет Node.js 24 (`node -v`), запустите контейнер; команды обработки выполняйте внутри него из `/app`. Секреты для скачивания фотографий не нужны:

```bash
cd /var/www/irk-name
docker run --rm -it -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app node:24 bash
```

```bash
# Внутри контейнера рабочая папка — /app; при запуске без Docker — /var/www/irk-name.
npm ci                                        # нужен sharp из devDependencies

# 0. Автопоиск портретов для записей, которых ещё нет в манифесте (Wikidata, свойство «изображение» P18).
#    Надёжная находка — только если это человек и совпадает год рождения (±1). Живые и архивные пропускаются.
node scripts/discover-photos.mjs              # отчёт: data/commons-photos.candidates.json
node scripts/discover-photos.mjs --write      # дописать надёжные находки в data/commons-photos.json
#   «?» в выводе — несколько кандидатов или у записи нет года: проверьте в отчёте и при желании
#   добавьте в манифест вручную.

# 1. Метаданные + скачивание в media/ (persons/<slug>.webp, -640, -160; heraldry/<key>.webp|svg)
node scripts/fetch-commons.mjs --dry-run      # только проверить, что файлы есть и лицензии свободные
node scripts/fetch-commons.mjs                # скачать; повторный запуск пропускает неизменённые файлы
#   --only slug1,slug2 — только эти записи;  --force — перекачать всё

# 2. Проверить lock-файл: автор, лицензия, источник; открыть пару картинок из media/
less data/commons-photos.lock.json
#   «✗ … не найдено» — имя файла в манифесте неверно; «✗ … лицензия» — файл несвободный:
#   поправьте data/commons-photos.json (или удалите запись) и повторите шаг 1.

# 3. Файлы уже находятся в media/ и доступны контейнеру nginx; отдельная загрузка не нужна.
curl -I https://cdn.irk.name/persons/sergey-trubetskoy.webp       # 200

# 4. Дописать photo во фронтматтер записей (только по lock-файлу; запись с другим фото не трогается без --force)
node scripts/fetch-commons.mjs --apply
npm run check && git diff --stat

# 5. Просмотрите изменения. Коммит и PR подготовьте с локального компьютера.
# После merge в main GitHub Actions выполнит deploy.sh на сервере.
```

Гербы в шапке не используются: эмблема сайта — бабр из герба Иркутска без щита (`public/emblem/`, `src/components/Babr.astro`), раздел `heraldry` в манифесте пуст. Фото: если файла нет на CDN, блок фото на странице персоны скрывается.

Добавить фото: после пополнения справочника запустите шаг 0 (автопоиск) или допишите `{ "slug", "file": "File:….jpg", "alt" }` в `data/commons-photos.json` вручную, затем шаги 1–5. Живым людям и записям с `archived: true` фото не подбираем.

## CI

`.github/workflows/ci.yml` на каждом PR запускает `npm run check`, `npm run build` и `docker build`. Автодеплой настроен и проверен 14.11.2026: после обновления `main` Actions выполняет сборку и запускает `deploy.sh` по ограниченному SSH-ключу.

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

### Фото из админки

В редакторе персоны можно загрузить до трёх фото за сохранение (JPEG, PNG, WebP, TIFF, до 25 МБ каждое), выбрать главное, изменить подписи/авторство/лицензию и убрать фото из карточки. Изображения обрабатываются в три WebP-размера (1200, 640, 160 px, без увеличения оригинала), с поворотом по EXIF и хэшем в имени. Удаление из карточки сохраняет файл в хранилище для отката.

Фотографии записываются в локальный каталог, а карточки — в GitHub. Для текущего сервера используется `ADMIN_MEDIA_STORE=fs`. В контейнере путь фиксирован: `ADMIN_MEDIA_ROOT=/data/media`, подключённый к `./media` на хосте. Указывать путь в `.env` при использовании Docker не требуется.

#### Включить загрузку на российском VPS

После публикации кода с этой доработкой подготовьте каталог. В образе `node:24-alpine` админка работает как пользователь `node`; определяем фактические UID/GID из используемого образа. Владельцев существующих файлов не меняем рекурсивно:

```bash
cd /var/www/irk-name
docker compose --profile admin build admin
MEDIA_UID=$(docker run --rm --entrypoint id irk-name-admin:latest -u node)
MEDIA_GID=$(docker run --rm --entrypoint id irk-name-admin:latest -g node)
sudo mkdir -p media/persons
sudo chown "$MEDIA_UID:$MEDIA_GID" media media/persons
sudo chmod 755 media media/persons
```

В `.env` уже добавлена настройка; проверьте, что она записана ровно один раз:

```dotenv
ADMIN_MEDIA_STORE=fs
```

Сохраните `COMPOSE_FILE=docker-compose.yml:compose.media.yaml` и `COMPOSE_PROFILES=admin`. Актуальный основной compose подключает `./media:/data/media` к админке; серверный nginx `media` продолжает читать тот же каталог read-only.

```bash
docker compose config --quiet
docker compose up -d admin
curl -fsS https://irk.name/admin/healthz
```

Войдите в `/admin`, откройте карточку, загрузите изображение с авторством и условиями публикации, отметьте «сделать главным» и сохраните. Проверьте фотографию в редакторе, успешный Actions Deploy и публичную карточку. В GitHub сохраняется запись, а файлы фото остаются на российском VPS; отдельно резервируйте `media/`. Серверная проверка проводится владельцем после публикации кода.

### Автодеплой (чтобы правки из админки сами попадали на сайт)

Без автодеплоя правки из админки сохраняются в репозиторий, а на сайт попадают после `bash deploy.sh` на сервере. С автодеплоем это делает GitHub Actions (`.github/workflows/deploy.yml`) после каждого обновления `main`: сначала проверка и сборка, затем вход на сервер по SSH-ключу, который может выполнить только `deploy.sh` (так же устроен деплой forestwatch).

1. На сервере создайте ключ и разрешите ему только деплой:
   ```bash
   ssh-keygen -t ed25519 -N '' -C 'github-actions-deploy@irk-name' -f ~/irk-name-deploy
   echo "command=\"cd /var/www/irk-name && bash deploy.sh\",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding $(cat ~/irk-name-deploy.pub)" >> ~/.ssh/authorized_keys
   ssh-keyscan -t ed25519 141.133.187.90
   ```
   Пользователь должен иметь право на `docker compose` (группа `docker`) и на `git` в `/var/www/irk-name`.
2. В GitHub → репозиторий → Settings → Secrets and variables → Actions добавьте секреты:
   `DEPLOY_SSH_KEY` (содержимое `~/irk-name-deploy`), `DEPLOY_HOST` (`141.133.187.90`), `DEPLOY_USER` (пользователь на сервере), `DEPLOY_KNOWN_HOSTS` (вывод `ssh-keyscan`).
3. Удалите приватный ключ с сервера: `rm ~/irk-name-deploy`.

Пока секреты не заданы, шаг деплоя в Actions просто пропускается. Отозвать доступ: удалить строку из `authorized_keys` и секрет `DEPLOY_SSH_KEY`.

## Форма «Предложить персону» (`/api/suggest`)

Сервис `forms` запускается вместе с сайтом (`docker compose up -d --build`), секретов не требует. Traefik направляет `irk.name/api/suggest` в этот контейнер (приоритет 100), всё остальное — в `web`.

- Предложения сохраняются JSON-файлами в docker-томе `irk-name_suggestions` **только на этом сервере** — не в git, не во внешних сервисах (требование хранения персональных данных в РФ).
- Читать и удалять — в админке: `/admin/predlozheniya` (нужен профиль `admin`, том подключён и к нему).
- Срок хранения — 1 год (как в политике): старые файлы удаляются автоматически раз в сутки. Рассмотренные предложения удаляйте вручную сразу.
- Защита: проверка Origin, ловушка для ботов, минимальное время заполнения, не более 10 отправок в час с IP (IP не сохраняется), лимит 16 КБ на запрос, обязательное согласие на обработку ПД (в записи фиксируется редакция политики).
- Резервные копии: том в бэкап репозитория не попадает. Если нужен бэкап — только на носитель в РФ, например: `docker run --rm -v irk-name_suggestions:/d -v "$PWD":/b alpine tar czf /b/suggestions.tgz -C /d .`
- Никогда не пересылайте содержимое предложений во внешние сервисы и чаты.
