#!/usr/bin/env bash
# Обновление сайта на сервере: последняя версия main → пересборка контейнеров.
# Вызывается вручную (bash deploy.sh) или из GitHub Actions по ограниченному SSH-ключу (DEPLOY.md).
set -euo pipefail
cd "$(dirname "$0")"
OLD=$(git rev-parse HEAD)
git fetch --quiet origin main
git merge --ff-only --quiet origin/main
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null
echo "deploy: $(git rev-parse --short HEAD) $(date -u +%FT%TZ)"
# Сообщить Яндексу и Bing об изменённых страницах персон (IndexNow; только публичные адреса сайта). Сбой не критичен.
if command -v node >/dev/null 2>&1; then
  node scripts/indexnow.mjs --from "$OLD" --to HEAD || true
fi
