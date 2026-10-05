#!/usr/bin/env bash
# Обновление сайта на сервере: последняя версия main → пересборка контейнеров.
# Вызывается вручную (bash deploy.sh) или из GitHub Actions по ограниченному SSH-ключу (DEPLOY.md).
set -euo pipefail
cd "$(dirname "$0")"
git fetch --quiet origin main
git merge --ff-only --quiet origin/main
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null
echo "deploy: $(git rev-parse --short HEAD) $(date -u +%FT%TZ)"
