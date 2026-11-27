#!/usr/bin/env bash
# Puts a saved database back, on the VPS (what was written since is lost; the
# current database is saved first).
#   deploy/restore.sh            lists the backups
#   deploy/restore.sh <file>     restores one
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose() { docker compose -f "$REPO/docker-compose.yml" --project-directory "$REPO" "$@"; }
APP_COMMIT="$(git -C "$REPO" rev-parse HEAD)"
export APP_COMMIT

main() {
  if [[ $# -eq 0 ]]; then
    ls -lh "$REPO/data/backups"
    return
  fi
  local name
  name="$(basename "$1")"
  [[ "$name" =~ ^piano-[A-Za-z0-9_-]+\.db$ && -f "$REPO/data/backups/$name" ]] || { echo "Sauvegarde introuvable : $name" >&2; exit 1; }
  read -r -p "Remplacer la base par $name ? Ce qui a été fait depuis sera perdu. [oui/N] " reply
  [[ "$reply" == oui ]] || exit 1

  compose run --rm --no-deps -T backend node dist/scripts/prepare-db.js avant-restauration
  compose stop backend
  compose run --rm --no-deps -T backend sh -c "cp data/backups/$name data/piano.db && rm -f data/piano.db-wal data/piano.db-shm"
  compose up -d --no-build --wait backend
  compose restart frontend
  echo "Base restaurée : $name"
}

main "$@"; exit
