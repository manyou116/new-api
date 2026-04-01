#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/www/wwwroot/new-api}"
SERVICE_NAME="${SERVICE_NAME:-new-api}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3000/api/status}"
LOCK_FILE="${LOCK_FILE:-/tmp/new-api-deploy.lock}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  echo "docker compose is not available" >&2
  exit 1
}

deploy() {
  cd "$PROJECT_DIR"
  compose pull "$SERVICE_NAME"
  compose up -d --no-deps "$SERVICE_NAME"

  local attempt
  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
    if curl -fsS "$HEALTHCHECK_URL" >/dev/null; then
      echo "deploy succeeded"
      return 0
    fi
    sleep "$SLEEP_SECONDS"
  done

  echo "health check failed: $HEALTHCHECK_URL" >&2
  return 1
}

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9
fi

deploy
