#!/usr/bin/env bash
# Seeds a LARGE shared album (default ~520 assets) used by the virtual-window
# stress spec (web/e2e/share-virtual-window.spec.ts) and the perf harness.
# Run after seed-immich.sh:
#   docker compose -f e2e/docker-compose.e2e.yml run --rm --no-deps \
#     --entrypoint /bin/bash seed /scripts/seed-large-album.sh
# Appends LARGE_SHARE_KEY / LARGE_ALBUM_ID / LARGE_ASSET_COUNT to seed.env.
set -Eeuo pipefail

IMMICH_BASE_URL="${IMMICH_BASE_URL:-http://immich-server:2283}"
API="${IMMICH_BASE_URL%/}/api"
RUNTIME_FILE="${RUNTIME_FILE:-/runtime/seed.env}"
IMMICH_ADMIN_EMAIL="${IMMICH_ADMIN_EMAIL:-admin@example.com}"
IMMICH_ADMIN_PASSWORD="${IMMICH_ADMIN_PASSWORD:-changeme123}"
LARGE_ALBUM_SIZE="${LARGE_ALBUM_SIZE:-520}"
BATCH_LOG_EVERY=50

log() { printf '[seed-large] %s\n' "$*"; }
die() { printf '[seed-large][error] %s\n' "$*" >&2; exit 1; }

TOKEN="$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"${IMMICH_ADMIN_EMAIL}\",\"password\":\"${IMMICH_ADMIN_PASSWORD}\"}" \
  "${API}/auth/login" | jq -r '.accessToken // empty')"
[[ -n "${TOKEN}" ]] || die "Immich admin login failed"

if [[ -f "${RUNTIME_FILE}" ]] && grep -q '^LARGE_SHARE_KEY=' "${RUNTIME_FILE}"; then
  # shellcheck disable=SC1090
  source "${RUNTIME_FILE}"
  existing="$(curl -sS -H "Authorization: Bearer ${TOKEN}" "${API}/albums/${LARGE_ALBUM_ID}" | jq -r '.assetCount // 0')"
  if [[ "${existing}" -ge "${LARGE_ALBUM_SIZE}" ]]; then
    log "Large album already seeded (${existing} assets), skipping"
    exit 0
  fi
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

IDS=()
log "Uploading ${LARGE_ALBUM_SIZE} generated images"
for ((i = 1; i <= LARGE_ALBUM_SIZE; i++)); do
  color="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
  width=$((320 + RANDOM % 480))
  height=$((240 + RANDOM % 360))
  file="${WORK_DIR}/large-${i}.jpg"
  ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "color=c=0x${color}:s=${width}x${height}:d=1" -frames:v 1 "${file}"

  month=$(((i % 12) + 1))
  day=$(((i % 27) + 1))
  printf -v date_iso '2023-%02d-%02dT10:00:00Z' "${month}" "${day}"

  response="$(curl -sS -X POST -H "Authorization: Bearer ${TOKEN}" \
    -F "assetData=@${file};type=image/jpeg;filename=large-${i}.jpg" \
    -F "deviceId=e2e-large-device" \
    -F "deviceAssetId=e2e-large-${i}" \
    -F "fileCreatedAt=${date_iso}" \
    -F "fileModifiedAt=${date_iso}" \
    "${API}/assets")"
  id="$(echo "${response}" | jq -r '.id // empty')"
  [[ -n "${id}" ]] || die "Upload ${i} failed: ${response}"
  IDS+=("${id}")
  rm -f "${file}"
  ((i % BATCH_LOG_EVERY == 0)) && log "uploaded ${i}/${LARGE_ALBUM_SIZE}"
done

ids_json="$(printf '%s\n' "${IDS[@]}" | jq -R . | jq -sc .)"
album_id="$(curl -sS -X POST -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d "$(jq -nc --argjson ids "${ids_json}" '{albumName: "E2E Large Album", assetIds: $ids}')" \
  "${API}/albums" | jq -r '.id // empty')"
[[ -n "${album_id}" ]] || die "Album creation failed"

share_key="$(curl -sS -X POST -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d "{\"type\":\"ALBUM\",\"albumId\":\"${album_id}\"}" \
  "${API}/shared-links" | jq -r '.key // empty')"
[[ -n "${share_key}" ]] || die "Shared link creation failed"

count="$(curl -sS -H "Authorization: Bearer ${TOKEN}" "${API}/albums/${album_id}" | jq -r '.assetCount')"

{
  echo "LARGE_SHARE_KEY=${share_key}"
  echo "LARGE_ALBUM_ID=${album_id}"
  echo "LARGE_ASSET_COUNT=${count}"
} >> "${RUNTIME_FILE}"

log "Large album ready: ${count} assets, key=${share_key}"
