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
export NORTE_RUNTIME_TOKEN NORTE_LOCAL_STATE_ABSOLUTE
NORTE_LOCAL_STATE_ABSOLUTE="$(cd "$STATE" && pwd)"
if [[ ! -f "$STATE/runtime-token" ]]; then
  (umask 077; python3 -c 'import secrets;print(secrets.token_urlsafe(48))' > "$STATE/runtime-token")
fi
NORTE_RUNTIME_TOKEN="$(cat "$STATE/runtime-token")"
if [[ ! -f "$STATE/runtime-keys/private.pem" ]]; then
  (umask 077; mkdir -p "$STATE/runtime-keys"; node - "$STATE/runtime-keys" <<'NODE'
const {generateKeyPairSync}=require('node:crypto');const fs=require('node:fs');const path=require('node:path');const key=generateKeyPairSync('ed25519');
fs.writeFileSync(path.join(process.argv[2],'private.pem'),key.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
fs.writeFileSync(path.join(process.argv[2],'public.pem'),key.publicKey.export({format:'pem',type:'spki'}),{mode:0o644});
NODE
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
    docker build -t norte-skillhub-runtime:local runtime
    (cd web && pnpm run build)
    "${COMPOSE[@]}" up -d --wait
    echo 'Web: http://127.0.0.1:48230 — local test admin: admin / Admin@staging2026'
    ;;
  down) "${COMPOSE[@]}" down --remove-orphans ;;
  status) "${COMPOSE[@]}" ps ;;
  logs) "${COMPOSE[@]}" logs --tail=100 server web ;;
  *) echo 'Usage: scripts/norte-local.sh {up|down|status|logs}' >&2; exit 2 ;;
esac
