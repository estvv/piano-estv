#!/usr/bin/env bash
# Deploys one tested commit of main on the VPS, database included.
#
#   By GitHub Actions: forced command of the deploy SSH key (the commit is the
#   command asked for, nothing else can be run). See docs/DEPLOY.md.
#   By hand: deploy/deploy.sh [commit]   (default: latest main)
#
# Build → save the database and rehearse its update on a copy → switch → check.
# Any failure puts the previous version back.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICES=(backend frontend)
declare -A CONTAINER=([backend]=piano-backend-estv [frontend]=piano-frontend-estv)

log() { printf '▸ %s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }
# Never the dev override, even if one is lying around.
compose() { docker compose -f "$REPO/docker-compose.yml" --project-directory "$REPO" "$@"; }

# Version answered through nginx, as a visitor gets it.
served_commit() {
  compose exec -T frontend wget -qO- http://127.0.0.1/health 2>/dev/null | sed -n 's/.*"commit":"\([0-9a-z]*\)".*/\1/p'
}

start() {
  export APP_COMMIT="$1"
  compose up -d --no-build --wait --wait-timeout 180 backend
  # nginx resolves the backend's address when it starts.
  compose up -d --no-build --force-recreate --no-deps frontend
}

wait_for() {
  local want="$1" i
  for ((i = 0; i < 30; i++)); do
    [[ "$(served_commit || true)" == "$want" ]] && return 0
    sleep 2
  done
  return 1
}

# Commits from before /health told its version answer without one.
wait_healthy() {
  local i
  for ((i = 0; i < 30; i++)); do
    compose exec -T frontend wget -qO- http://127.0.0.1/health >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

# Called by the EXIT trap of apply.
# shellcheck disable=SC2329
rollback() {
  local status=$?
  trap - EXIT
  set +e
  [[ "$status" -eq 0 ]] && exit 0
  printf '✗ Échec : retour à la version précédente (%s)\n' "${PREVIOUS:0:7}" >&2
  git -C "$REPO" reset --keep --quiet "$PREVIOUS"
  local s
  for s in "${SERVICES[@]}"; do
    [[ -n "${OLD_IMAGE[$s]:-}" && -n "${OLD_NAME[$s]:-}" ]] && docker tag "${OLD_IMAGE[$s]}" "${OLD_NAME[$s]}"
  done
  if [[ "$SWITCHED" -eq 1 ]]; then
    start "$PREVIOUS"
    if wait_healthy; then
      log 'La version précédente répond de nouveau.'
    else
      printf '✗ La version précédente ne répond pas non plus : à regarder à la main.\n' >&2
    fi
  else
    log "Le site n'a pas été touché."
  fi
  exit 1
}

apply() {
  PREVIOUS="$1"
  local target="$2" s
  SWITCHED=0
  declare -gA OLD_IMAGE=() OLD_NAME=()
  for s in "${SERVICES[@]}"; do
    OLD_IMAGE[$s]="$(docker inspect -f '{{.Image}}' "${CONTAINER[$s]}" 2>/dev/null || true)"
    OLD_NAME[$s]="$(docker inspect -f '{{.Config.Image}}' "${CONTAINER[$s]}" 2>/dev/null || true)"
  done
  trap rollback EXIT
  export APP_COMMIT="$target"

  log 'Construction des images…'
  compose build --quiet

  log 'Sauvegarde et répétition de la mise à jour de la base…'
  compose run --rm --no-deps -T backend node dist/scripts/prepare-db.js "${target:0:7}"

  log 'Bascule…'
  SWITCHED=1
  start "$target"
  wait_for "$target" || die 'La nouvelle version ne répond pas.'

  trap - EXIT
  # The replaced images, if nothing else uses them.
  for s in "${SERVICES[@]}"; do
    [[ -n "${OLD_IMAGE[$s]}" ]] && docker image rm "${OLD_IMAGE[$s]}" >/dev/null 2>&1 || true
  done
  log "En ligne : ${target:0:7}"
}

main() {
  cd "$REPO"
  if [[ "${1:-}" == --apply ]]; then
    apply "$2" "$3"
    return
  fi

  exec 9>"${TMPDIR:-/tmp}/piano-estv-deploy.lock"
  flock -w 1200 9 || die 'Un autre déploiement est en cours.'

  local asked="${SSH_ORIGINAL_COMMAND:-${1:-}}"
  [[ -z "$asked" || "$asked" =~ ^[0-9a-f]{40}$ ]] || die 'Commande refusée : un commit est attendu.'
  [[ "$(git branch --show-current)" == main ]] || die "Le dépôt du VPS n'est pas sur main."
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "Des fichiers suivis ont été modifiés sur le VPS : rien n'est écrasé, à régler à la main (git status)."

  git fetch --quiet origin main
  local target previous
  target="${asked:-$(git rev-parse FETCH_HEAD)}"
  previous="$(git rev-parse HEAD)"
  git merge-base --is-ancestor "$target" FETCH_HEAD 2>/dev/null || die "Le commit ${target:0:7} n'est pas sur main."
  git merge-base --is-ancestor "$previous" FETCH_HEAD || die 'Le VPS a des commits absents de GitHub : à régler à la main.'
  if [[ "$target" != "$previous" ]] && git merge-base --is-ancestor "$target" "$previous"; then
    log "Une version plus récente est déjà en place (${previous:0:7})."
    return
  fi

  log "${previous:0:7} → ${target:0:7} : $(git log -1 --format=%s "$target")"
  git reset --keep --quiet "$target"
  # The new version's own script finishes the job.
  exec "$REPO/deploy/deploy.sh" --apply "$previous" "$target"
}

main "$@"; exit
