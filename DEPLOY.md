# Деплой на VPS (Docker + Traefik)

Сайт — статика (`dist/`), которую отдаёт nginx в контейнере `web` (и админка `admin`, если включена). Контейнеры подключаются к уже работающему Traefik; порты наружу не публикуются. Картинки лежат в S3-бакете Beget и раздаются через **CDN Beget** на `cdn.irk.name` — на VPS для этого ничего не запускается.

> Секретов в репозитории нет и быть не должно (репозиторий публичный). Ключи S3 нужны только для загрузки картинок и хранятся в переменных окружения / GitHub Secrets.

## 1. DNS

| Тип | Имя | Значение |
| --- | --- | --- |
| A | `irk.name` | `90.156.168.149` |
| A | `www.irk.name` | `90.156.168.149` |
| CNAME | `cdn.irk.name` | адрес CDN-ресурса из панели Beget (вида `xxxxxxxx.a.trbcdn.net`) |

`www` автоматически редиректится на `irk.name` (301). Сертификат для `cdn.irk.name` выпускает CDN Beget, Traefik в этом не участвует.

## 2. Настройка

```bash
mkdir -p /var/www/irk-name && cd /var/www/irk-name   # путь по конвенции сервера
git clone https://github.com/tulubyev/irk-name.git .
cp .env.example .env
$EDITOR .env
```

Значения по умолчанию уже соответствуют серверу (см. `tulubyev/vps-server-infra`: Traefik v2.11, сеть `traefik-public`, entrypoints `web`/`websecure`, certresolver `letsencrypt`, глобальный редирект http→https). Менять обычно ничего не нужно:

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

## Медиа-хранилище (Beget S3)

1. В панели Beget создайте S3-бакет (у нас: `0a011f8d633a-irk-name`), включите **публичное чтение** объектов. Запишите эндпоинт и регион, создайте ключ доступа.
2. Подключите к бакету CDN Beget с доменом `cdn.irk.name` и поставьте CNAME из таблицы DNS выше. Проверка: `curl -I https://cdn.irk.name/persons/<файл>.webp` → `200`.
3. Подготовьте картинки локально в папке `media/` (она в `.gitignore`): для каждой персоны три webp — `persons/<slug>.webp` (до 1200 px), `persons/<slug>-640.webp` и `persons/<slug>-160.webp` (миниатюра в карточке). Для фото с Wikimedia Commons это делает `scripts/fetch-commons.mjs` — см. «Фото и гербы» ниже. Для неизменяемых файлов добавляйте хэш в имя (`<slug>-<8+ hex>.webp`) — они получат `immutable` на год.
4. Загрузите (ключи из окружения):

```bash
export S3_ENDPOINT=… S3_REGION=… S3_BUCKET=… S3_FORCE_PATH_STYLE=true
export S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=…
npm run upload-media -- --dry-run   # посмотреть, что будет загружено
npm run upload-media                # загрузить; повторный запуск пропускает неизменённые файлы
```

5. В карточке персоны укажите `photo.key` (`persons/<slug>.webp`), автора, лицензию и ссылку на источник — они выводятся под фото. Только свободные лицензии.

**Обновить картинку:** CDN кеширует файлы, поэтому изменённую картинку проще загрузить под новым именем (с хэшем, например `<slug>-<8+ hex>.webp`) и поменять `photo.key`. Сбросить кеш конкретного файла можно в панели CDN Beget.

## Фото и гербы

Фото персон и гербы берутся **только с Wikimedia Commons** и только со свободными лицензиями. Список файлов — `data/commons-photos.json` (`persons`: `slug` → `file` + `alt`; `heraldry`: гербы для шапки). Автор, лицензия и ссылки **не заполняются вручную** — их получает из API Commons скрипт `scripts/fetch-commons.mjs`. Скрипт запускается на сервере (из облачных сред Commons часто недоступен), Node.js 22.

Белый список лицензий: Public domain, PD-*, CC0, CC BY *, CC BY-SA *. Файлы с другой лицензией (NC/ND, GFDL, fair use, без лицензии) скрипт пропускает и печатает списком.

```bash
cd /var/www/irk-name && git pull
npm ci                                        # нужен sharp из devDependencies

# 1. Метаданные + скачивание в media/ (persons/<slug>.webp, -640, -160; heraldry/<key>.webp|svg)
node scripts/fetch-commons.mjs --dry-run      # только проверить, что файлы есть и лицензии свободные
node scripts/fetch-commons.mjs                # скачать; повторный запуск пропускает неизменённые файлы
#   --only slug1,slug2 — только эти записи;  --force — перекачать всё

# 2. Проверить lock-файл: автор, лицензия, источник; открыть пару картинок из media/
less data/commons-photos.lock.json
#   «✗ … не найдено» — имя файла в манифесте неверно; «✗ … лицензия» — файл несвободный:
#   поправьте data/commons-photos.json (или удалите запись) и повторите шаг 1.

# 3. Загрузить картинки в бакет (ключи S3 — из окружения, см. «Медиа-хранилище»)
node scripts/upload-media.mjs --dry-run
node scripts/upload-media.mjs
curl -I https://cdn.irk.name/persons/anton-chekhov.webp            # 200

# 4. Дописать photo во фронтматтер записей (только по lock-файлу; запись с другим фото не трогается без --force)
node scripts/fetch-commons.mjs --apply
npm run check && git diff --stat

# 5. Коммит и деплой
git add data/commons-photos.lock.json src/content/persons
git commit -m "Photos from Wikimedia Commons"
git push                                       # нужен доступ на запись; иначе — PR с ноутбука
bash deploy.sh
```

Гербы в шапке не используются: эмблема сайта — бабр из герба Иркутска без щита (`public/emblem/`, `src/components/Babr.astro`), раздел `heraldry` в манифесте пуст. Фото: если файла нет на CDN, блок фото на странице персоны скрывается.

Добавить фото: допишите `{ "slug", "file": "File:….jpg", "alt" }` в `data/commons-photos.json` и повторите шаги 1–5. Живым людям и записям с `archived: true` фото не подбираем.

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

## Форма «Предложить персону» (`/api/suggest`)

Сервис `forms` запускается вместе с сайтом (`docker compose up -d --build`), секретов не требует. Traefik направляет `irk.name/api/suggest` в этот контейнер (приоритет 100), всё остальное — в `web`.

- Предложения сохраняются JSON-файлами в docker-томе `irk-name_suggestions` **только на этом сервере** — не в git, не во внешних сервисах (требование хранения персональных данных в РФ).
- Читать и удалять — в админке: `/admin/predlozheniya` (нужен профиль `admin`, том подключён и к нему).
- Срок хранения — 1 год (как в политике): старые файлы удаляются автоматически раз в сутки. Рассмотренные предложения удаляйте вручную сразу.
- Защита: проверка Origin, ловушка для ботов, минимальное время заполнения, не более 10 отправок в час с IP (IP не сохраняется), лимит 16 КБ на запрос, обязательное согласие на обработку ПД (в записи фиксируется редакция политики).
- Резервные копии: том в бэкап репозитория не попадает. Если нужен бэкап — только на носитель в РФ, например: `docker run --rm -v irk-name_suggestions:/d -v "$PWD":/b alpine tar czf /b/suggestions.tgz -C /d .`
- Никогда не пересылайте содержимое предложений во внешние сервисы и чаты.
