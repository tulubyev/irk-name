# Размещение irk.name — 14.11.2026

## Подтверждённое состояние

- VPS: `141.133.187.90` (`alt1.fvds.ru`), пользователь `tulubyev`, проект `/var/www/irk-name`.
- A-записи `irk.name`, `www.irk.name`, `cdn.irk.name` направлены на этот VPS.
- Traefik: сеть `traefik-public`, entrypoints `web`/`websecure`, resolver `letsencrypt`; HTTP перенаправляется на HTTPS.
- `web`, `forms`, `admin` прошли health-проверки. Пользователь подтвердил работу админки.
- `media` отдаёт фотографии из `./media` через nginx. HTTPS проверен с валидацией сертификата; `www` отвечает перенаправлением 308.
- Автодеплой проверен: [Actions 43563573663](https://github.com/tulubyev/irk-name/actions/runs/43563573663), build и deploy успешны.
- Старых предложений посетителей не было; перенос данных не требовался. Новые сохраняются в томе `suggestions`.

## Серверная конфигурация

В `.env` (права 600), кроме секретов админки:

```dotenv
COMPOSE_FILE=docker-compose.yml:compose.media.yaml
COMPOSE_PROFILES=admin
PUBLIC_CDN_URL=https://cdn.irk.name
```

Серверный `compose.media.yaml` содержит:

```yaml
services:
  media:
    image: nginx:stable-alpine
    restart: unless-stopped
    volumes:
      - ./media:/usr/share/nginx/html:ro
    networks:
      - traefik
    labels:
      - traefik.enable=true
      - traefik.docker.network=traefik-public
      - traefik.http.routers.irkname-media.rule=Host(`cdn.irk.name`)
      - traefik.http.routers.irkname-media.entrypoints=websecure
      - traefik.http.routers.irkname-media.tls.certresolver=letsencrypt
      - traefik.http.services.irkname-media.loadbalancer.server.port=80
```

Файл пока поддерживается на сервере: не удалять его при обновлении. `deploy.sh` читает `COMPOSE_FILE` из `.env`, поэтому включает медиа при `--remove-orphans`.

Админка сохраняет Markdown в `tulubyev/irk-name`, ветка `main`, через fine-grained PAT с Contents read/write. Actions использует `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`. SSH-ключ ограничен командой `cd /var/www/irk-name && bash deploy.sh`. Удаление серверной копии приватного ключа предложено, но отдельно не подтверждено.

**Загрузка фото:** локальная доработка поддерживает `ADMIN_MEDIA_STORE=fs`, независимо от GitHub-карточек. Для включения на VPS нужно сначала опубликовать код и применить настройки из раздела «Фото из админки» в DEPLOY.md. На момент этой записи сервер ещё использует прежний код; внедрение доработки отдельно не подтверждено.

## Изображения и покрытие

Подсчёт по текущему контенту (549 карточек):

| Показатель | Количество |
| --- | ---: |
| Все персоны | 549 |
| Опубликованные (не archived) | 529 |
| Архивные | 20 |
| Карточки с главным фото | 178 |
| Изображения, указанные в карточках, включая галереи | 179 |
| Восстановленные портреты Commons | 177 |
| Опубликованные персоны без восстановленного портрета | 352 |

Восстановлены 17 портретов из локального `media-persons-new.zip` и 160 через `scripts/fetch-commons.mjs`. Каждый имеет три размера WebP: основной, `-640`, `-160`; это 531 файл, а не 531 отдельный портрет. Пользователь сообщил: годных 177, ошибок/отказов/ненайденных 0. Рабочий lock-файл на сервере: `media/commons-photos.restore.lock.json`.

Покрытие восстановленными портретами: **177/529 = 33,5% опубликованных**, либо **177/549 = 32,2% всей базы**. Наличие поля `photo` даёт 178/529 = 33,6%, но не доказывает наличие файла.

Отсутствуют в манифесте Commons и восстановленном наборе два изображения из семейного архива в карточке `nikolai-nasonov`:

- `persons/nikolai-nasonov-8c360cd94f.webp` — главное фото;
- `persons/nikolai-nasonov-3406890d47.webp` — галерея.

Их нужно найти отдельно. В документах также есть локальный список 57 кандидатов (`docs/EMIGRANTS.md`), но это не утверждённый итоговый объём базы и не доказательство отсутствия пересечений с существующими карточками.

## Проверка и сохранность

```bash
cd /var/www/irk-name
docker compose ps
curl -fsS https://irk.name/healthz
curl -fsS https://irk.name/admin/healthz
curl -fsS https://irk.name/api/suggest/healthz
curl -I https://cdn.irk.name/persons/sergey-trubetskoy.webp
```

В GitHub нет полного набора фотографий: `media/` игнорируется. Сохранять отдельно `media/`, `.env`, `compose.media.yaml` и том предложений (последний — только в РФ). Автоматическое резервное копирование этих данных пока не подтверждено.
