#!/usr/bin/env bash
# Copies the accounts and pieces of learn-estv into piano-estv, on the VPS.
#
#   deploy/import-from-learn.sh            first copy (refused if piano already has data)
#   deploy/import-from-learn.sh --replace  copy again: piano's accounts and pieces are replaced
#
# learn-estv keeps running and is only read: its database is exported by its
# own container (a consistent copy, even while in use), then copied here.
# piano's database is saved first (data/backups/piano-…-avant-import.db).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEARN_CONTAINER=learn-backend-estv
EXPORT=piano-export.db
compose() { docker compose -f "$REPO/docker-compose.yml" --project-directory "$REPO" "$@"; }
log() { printf '▸ %s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

REPLACE=()
case "${1:-}" in
  '') ;;
  --replace) REPLACE=(--replace) ;;
  *) die "Option inconnue : $1 (seule --replace existe)" ;;
esac

APP_COMMIT="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo dev)"
export APP_COMMIT

docker inspect "$LEARN_CONTAINER" >/dev/null 2>&1 || die "Conteneur $LEARN_CONTAINER introuvable : learn-estv doit tourner."
LEARN_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$LEARN_CONTAINER")"
[[ -d "$LEARN_DIR/data" ]] || die "Dossier de learn-estv introuvable : $LEARN_DIR/data"

cleanup() { docker exec "$LEARN_CONTAINER" rm -f "/app/data/$EXPORT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

log 'Export de la base de learn-estv…'
docker exec "$LEARN_CONTAINER" node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/learn.db', { readonly: true, fileMustExist: true });
  db.backup('/app/data/$EXPORT').then(() => {
    db.close();
    // A single file, readable from a read-only mount.
    new Database('/app/data/$EXPORT').pragma('journal_mode = DELETE');
  }, (e) => { console.error(e.message); process.exit(1); });
"

if [[ ${#REPLACE[@]} -gt 0 ]]; then
  read -r -p "Remplacer les comptes et morceaux de piano-estv par ceux de learn-estv ? [oui/N] " reply
  [[ "$reply" == oui ]] || die 'Rien n’a été touché.'
fi

log 'Copie dans piano-estv…'
compose stop backend
# Whatever happens, the piano starts again.
compose run --rm --no-deps -T -v "$LEARN_DIR/data/$EXPORT:/app/import/learn.db:ro" \
  backend node dist/scripts/import-learn.js /app/import/learn.db "${REPLACE[@]}" || status=$?
compose up -d --no-build --wait backend
compose restart frontend >/dev/null
[[ "${status:-0}" -eq 0 ]] || die 'La copie a échoué : piano-estv est reparti avec sa base d’avant.'
log 'Terminé. Les comptes se reconnectent avec leurs identifiants habituels.'
