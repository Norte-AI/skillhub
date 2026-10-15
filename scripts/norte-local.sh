#!/usr/bin/env bash
# Repeatable local acceptance deployment; private config remains outside Git.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="${NORTE_LOCAL_STATE:-$ROOT/.norte-local}"
mkdir -p "$STATE"
chmod 700 "$STATE"
CONFIG="$STATE/git-config.json"
if [[ ! -f "$CONFIG" ]]; then
  (umask 077; python3 - "$CONFIG" <<'PY'
import json,secrets,sys
config={'skillhub':{'git':{'providers':{'[gitlab.com]':{'kind':'GITLAB','api-base':'https://gitlab.com/api/v4','archive-base':'https://gitlab.com/api/v4'}},'automatic-sync-enabled':True,'webhook-secret':secrets.token_urlsafe(48)}}}
with open(sys.argv[1],'w') as output:json.dump(config,output)
PY
  )
fi
export NORTE_GIT_CONFIG_JSON
NORTE_GIT_CONFIG_JSON="$(cat "$CONFIG")"
cd "$ROOT"
COMPOSE=(docker compose -p norte-web-git-check -f docker-compose.yml -f docker-compose.staging.yml -f deploy/norte-local/compose.override.yml)
case "${1:-status}" in
  up)
    (cd server && ./mvnw package -DskipTests -B -q)
    docker build -t norte-skillhub-web-git:staging-check -f server/Dockerfile.dev server
    (cd web && pnpm run build)
    "${COMPOSE[@]}" up -d --wait
    echo 'Web: http://127.0.0.1:48230 — local test admin: admin / Admin@staging2026'
    ;;
  down) "${COMPOSE[@]}" down --remove-orphans ;;
  status) "${COMPOSE[@]}" ps ;;
  logs) "${COMPOSE[@]}" logs --tail=100 server web ;;
  *) echo 'Usage: scripts/norte-local.sh {up|down|status|logs}' >&2; exit 2 ;;
esac
