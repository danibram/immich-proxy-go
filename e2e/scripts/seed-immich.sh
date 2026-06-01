#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

IMMICH_BASE_URL="${IMMICH_BASE_URL:-http://immich-server:2283}"
IMMICH_API_URL="${IMMICH_BASE_URL%/}/api"
RUNTIME_FILE="${RUNTIME_FILE:-/runtime/seed.env}"
SEED_MEDIA_DIR="${SEED_MEDIA_DIR:-/tmp/seed-media}"

IMMICH_ADMIN_EMAIL="${IMMICH_ADMIN_EMAIL:-admin@example.com}"
IMMICH_ADMIN_NAME="${IMMICH_ADMIN_NAME:-E2E Admin}"
IMMICH_ADMIN_PASSWORD="${IMMICH_ADMIN_PASSWORD:-changeme123}"
SHARED_SLUG="${SHARED_SLUG:-}"
if [[ -z "${SHARED_SLUG}" ]]; then
  SHARED_SLUG="e2e-shared-album-$(date -u +%s)"
fi
DEFAULT_SHARED_SLUG="${DEFAULT_SHARED_SLUG:-${SHARED_SLUG}}"
OVERRIDE_ON_SHARED_SLUG="${OVERRIDE_ON_SHARED_SLUG:-${SHARED_SLUG}-override-on}"
OVERRIDE_OFF_SHARED_SLUG="${OVERRIDE_OFF_SHARED_SLUG:-${SHARED_SLUG}-override-off}"
METADATA_OFF_SHARED_SLUG="${METADATA_OFF_SHARED_SLUG:-${SHARED_SLUG}-metadata-off}"
PASSWORD_PROTECTED_SHARED_SLUG="${PASSWORD_PROTECTED_SHARED_SLUG:-${SHARED_SLUG}-protected}"
PASSWORD_PROTECTED_B_SHARED_SLUG="${PASSWORD_PROTECTED_B_SHARED_SLUG:-${SHARED_SLUG}-protected-b}"
E2E_SHARE_PASSWORD="${E2E_SHARE_PASSWORD:-e2e-secret-password}"
E2E_SHARE_PASSWORD_B="${E2E_SHARE_PASSWORD_B:-another-e2e-password}"

E2E_IMAGE_COUNT="${E2E_IMAGE_COUNT:-24}"

declare -a SEED_ASSET_IDS=()

log() {
  printf '[seed] %s\n' "$*"
}

die() {
  printf '[seed][error] %s\n' "$*" >&2
  exit 1
}

json_request() {
  local method="$1"
  local endpoint="$2"
  local body="$3"
  local auth_header="${4:-}"
  local output_file="$5"

  local curl_args=(
    -sS
    -X "$method"
    -H "Content-Type: application/json"
    -o "$output_file"
    -w "%{http_code}"
  )

  if [[ -n "$auth_header" ]]; then
    curl_args+=(-H "$auth_header")
  fi
  if [[ -n "$body" ]]; then
    curl_args+=(-d "$body")
  fi

  curl "${curl_args[@]}" "${IMMICH_API_URL}${endpoint}"
}

wait_for_immich() {
  log "Waiting for Immich API at ${IMMICH_API_URL}"
  local attempt=0
  local max_attempts=120

  until curl -sS -f "${IMMICH_API_URL}/server/ping" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if (( attempt >= max_attempts )); then
      die "Immich API did not become ready after ${max_attempts} attempts"
    fi
    sleep 2
  done
}

create_admin() {
  local payload
  payload="$(jq -nc \
    --arg email "${IMMICH_ADMIN_EMAIL}" \
    --arg name "${IMMICH_ADMIN_NAME}" \
    --arg password "${IMMICH_ADMIN_PASSWORD}" \
    '{email: $email, name: $name, password: $password}')"

  local status
  status="$(json_request "POST" "/auth/admin-sign-up" "${payload}" "" "/tmp/signup.json")"

  case "$status" in
    201) log "Admin user created" ;;
    400|409) log "Admin already exists, continuing" ;;
    *)
      cat /tmp/signup.json >&2 || true
      die "Failed to create admin user (status: ${status})"
      ;;
  esac
}

login_admin() {
  local payload
  payload="$(jq -nc \
    --arg email "${IMMICH_ADMIN_EMAIL}" \
    --arg password "${IMMICH_ADMIN_PASSWORD}" \
    '{email: $email, password: $password}')"

  local status
  status="$(json_request "POST" "/auth/login" "${payload}" "" "/tmp/login.json")"
  if [[ "$status" != "201" ]]; then
    cat /tmp/login.json >&2 || true
    die "Login failed (status: ${status})"
  fi

  ACCESS_TOKEN="$(jq -r '.accessToken // empty' /tmp/login.json)"
  if [[ -z "${ACCESS_TOKEN}" ]]; then
    cat /tmp/login.json >&2 || true
    die "Login did not return accessToken"
  fi
}

generate_seed_media() {
  log "Generating fake media in ${SEED_MEDIA_DIR}"
  rm -rf "${SEED_MEDIA_DIR}"
  mkdir -p "${SEED_MEDIA_DIR}"

  local i width height hex_color
  for ((i = 1; i <= E2E_IMAGE_COUNT; i++)); do
    width=$((400 + (i % 5) * 160))
    height=$((300 + (i % 4) * 120))
    if (( i % 7 == 0 )); then
      local tmp="${width}"
      width="${height}"
      height="${tmp}"
    fi
    hex_color="0x$(printf '%02x%02x%02x' $((i * 7 % 200 + 40)) $((i * 13 % 200 + 40)) $((i * 19 % 200 + 40)))"
    ffmpeg -y -hide_banner -loglevel error \
      -f lavfi -i "color=c=${hex_color}:s=${width}x${height}:d=1" \
      -frames:v 1 \
      "${SEED_MEDIA_DIR}/e2e-photo-${i}.jpg"
  done

  ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "testsrc=duration=2:size=640x360:rate=24" \
    -f lavfi -i "sine=frequency=440:duration=2" \
    -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
    "${SEED_MEDIA_DIR}/e2e-clip.mp4"

  log "Generated ${E2E_IMAGE_COUNT} images and 1 video"
}

upload_file_asset() {
  local file_path="$1"
  local mime_type="$2"
  local filename="$3"
  local file_created_at="$4"
  local device_asset_id="$5"
  local out_json="$6"

  local status
  status="$(curl -sS \
    -X POST \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -F "assetData=@${file_path};type=${mime_type};filename=${filename}" \
    -F "deviceId=e2e-device" \
    -F "deviceAssetId=${device_asset_id}" \
    -F "fileCreatedAt=${file_created_at}" \
    -F "fileModifiedAt=${file_created_at}" \
    -o "${out_json}" \
    -w "%{http_code}" \
    "${IMMICH_API_URL}/assets")"

  if [[ "$status" != "201" && "$status" != "200" ]]; then
    cat "${out_json}" >&2 || true
    die "Asset upload failed for ${filename} (status: ${status})"
  fi

  jq -r '.id // empty' "${out_json}"
}

wait_for_asset_ready() {
  local asset_id="$1"
  local expect_type="${2:-}"
  local attempt=0
  local max_attempts=90

  while (( attempt < max_attempts )); do
    local status
    status="$(curl -sS \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -o /tmp/asset-status.json \
      -w "%{http_code}" \
      "${IMMICH_API_URL}/assets/${asset_id}")"

    if [[ "${status}" == "200" ]]; then
      local asset_type duration
      asset_type="$(jq -r '.type // empty' /tmp/asset-status.json)"
      duration="$(jq -r '.duration // empty' /tmp/asset-status.json)"

      if [[ -n "${expect_type}" && "${asset_type}" != "${expect_type}" ]]; then
        attempt=$((attempt + 1))
        sleep 2
        continue
      fi

      if [[ "${expect_type}" == "VIDEO" && -z "${duration}" ]]; then
        attempt=$((attempt + 1))
        sleep 2
        continue
      fi

      return 0
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  die "Asset ${asset_id} did not become ready (type=${expect_type})"
}

upload_seed_assets() {
  log "Uploading seed assets to Immich"
  SEED_ASSET_IDS=()

  local i date_iso asset_id month
  for ((i = 1; i <= E2E_IMAGE_COUNT; i++)); do
    month=$(( (i % 12) + 1 ))
    printf -v date_iso "2024-%02d-15T12:00:00Z" "${month}"
    asset_id="$(upload_file_asset \
      "${SEED_MEDIA_DIR}/e2e-photo-${i}.jpg" \
      "image/jpeg" \
      "e2e-photo-${i}.jpg" \
      "${date_iso}" \
      "e2e-photo-${i}-$(date -u +%s)" \
      "/tmp/upload-${i}.json")"
    [[ -n "${asset_id}" ]] || die "Missing asset id for image ${i}"
    SEED_ASSET_IDS+=("${asset_id}")
  done

  date_iso="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  VIDEO_ASSET_ID="$(upload_file_asset \
    "${SEED_MEDIA_DIR}/e2e-clip.mp4" \
    "video/mp4" \
    "e2e-clip.mp4" \
    "${date_iso}" \
    "e2e-video-$(date -u +%s)" \
    "/tmp/upload-video.json")"
  [[ -n "${VIDEO_ASSET_ID}" ]] || die "Missing asset id for video"
  SEED_ASSET_IDS+=("${VIDEO_ASSET_ID}")

  log "Waiting for video asset processing"
  wait_for_asset_ready "${VIDEO_ASSET_ID}" "VIDEO"

  ASSET_ID="${SEED_ASSET_IDS[0]}"
  FIRST_ASSET_ID="${ASSET_ID}"
  EXPECTED_ASSET_COUNT="${#SEED_ASSET_IDS[@]}"
  log "Uploaded ${EXPECTED_ASSET_COUNT} assets (first=${FIRST_ASSET_ID}, video=${VIDEO_ASSET_ID})"
}

create_album_with_assets() {
  local album_name="$1"
  local album_description="$2"
  local output_file="$3"
  local id_var_name="$4"
  shift 4
  local -a album_asset_ids=("$@")

  local asset_json
  asset_json="$(asset_ids_json "${album_asset_ids[@]}")"

  local payload
  payload="$(jq -nc \
    --arg name "${album_name}" \
    --arg description "${album_description}" \
    --argjson asset_ids "${asset_json}" \
    '{albumName: $name, description: $description, assetIds: $asset_ids}')"

  local status
  status="$(json_request "POST" "/albums" "${payload}" "Authorization: Bearer ${ACCESS_TOKEN}" "${output_file}")"
  if [[ "$status" != "201" ]]; then
    cat "${output_file}" >&2 || true
    die "Failed to create album '${album_name}' (status: ${status})"
  fi

  local album_id
  album_id="$(jq -r '.id // empty' "${output_file}")"
  if [[ -z "${album_id}" ]]; then
    cat "${output_file}" >&2 || true
    die "Album '${album_name}' response did not include an album ID"
  fi

  printf -v "${id_var_name}" '%s' "${album_id}"
}

create_test_albums() {
  local name desc id_var
  while IFS='|' read -r name id_var desc; do
    [[ -z "${name}" ]] && continue
    create_album_with_assets \
      "${name}" \
      "${desc}" \
      "/tmp/album-${id_var}.json" \
      "${id_var}" \
      "${SEED_ASSET_IDS[@]}"
  done <<'EOF'
E2E Default Flags Album|DEFAULT_ALBUM_ID|Album used to validate Immich default shared-link flags
E2E Override On Album|OVERRIDE_ON_ALBUM_ID|Album used to validate explicit override flags set to true
E2E Override Off Album|OVERRIDE_OFF_ALBUM_ID|Album used to validate explicit override flags set to false
EOF
}

create_private_album() {
  create_album_with_assets \
    "E2E Private Album" \
    "Album that must NOT be reachable from public share routes" \
    "/tmp/private-album.json" \
    "PRIVATE_ALBUM_ID" \
    "${ASSET_ID}"
}

create_password_protected_album() {
  create_album_with_assets \
    "E2E Password Protected Album" \
    "Album reachable only after password validation through the proxy" \
    "/tmp/password-protected-album.json" \
    "PASSWORD_PROTECTED_ALBUM_ID" \
    "${ASSET_ID}" "${SEED_ASSET_IDS[1]}"
  PASSWORD_PROTECTED_ASSET_ID="${ASSET_ID}"
}

create_password_protected_album_b() {
  create_album_with_assets \
    "E2E Password Protected Album B" \
    "Second password-protected album for cross-share isolation tests" \
    "/tmp/password-protected-album-b.json" \
    "PASSWORD_PROTECTED_B_ALBUM_ID" \
    "${SEED_ASSET_IDS[2]}" "${SEED_ASSET_IDS[3]}"
  PASSWORD_PROTECTED_B_ASSET_ID="${SEED_ASSET_IDS[2]}"
}

create_one_shared_link() {
  local key_var="$1"
  local slug_var="$2"
  local album_id="$3"
  local slug="$4"
  local flags_json="$5"
  local password="${6:-}"
  local out_file="/tmp/shared-link-${key_var}.json"

  local payload
  if [[ -n "${password}" ]]; then
    payload="$(jq -nc \
      --arg album_id "${album_id}" \
      --arg slug "${slug}" \
      --arg password "${password}" \
      --argjson flags "${flags_json}" \
      '{type: "ALBUM", albumId: $album_id, slug: $slug, password: $password} + $flags')"
  else
    payload="$(jq -nc \
      --arg album_id "${album_id}" \
      --arg slug "${slug}" \
      --argjson flags "${flags_json}" \
      '{type: "ALBUM", albumId: $album_id, slug: $slug} + $flags')"
  fi

  local status
  status="$(json_request "POST" "/shared-links" "${payload}" "Authorization: Bearer ${ACCESS_TOKEN}" "${out_file}")"
  if [[ "$status" != "201" ]]; then
    cat "${out_file}" >&2 || true
    die "Failed to create shared link ${key_var} (status: ${status})"
  fi

  local share_key share_slug
  share_key="$(jq -r '.key // empty' "${out_file}")"
  share_slug="$(jq -r '.slug // empty' "${out_file}")"
  if [[ -z "${share_key}" ]]; then
    cat "${out_file}" >&2 || true
    die "Shared link ${key_var} response did not include key"
  fi

  printf -v "${key_var}" '%s' "${share_key}"
  printf -v "${slug_var}" '%s' "${share_slug}"
}

create_shared_links() {
  create_one_shared_link DEFAULT_SHARE_KEY DEFAULT_SHARE_SLUG "${DEFAULT_ALBUM_ID}" "${DEFAULT_SHARED_SLUG}" '{}'
  create_one_shared_link OVERRIDE_ON_SHARE_KEY OVERRIDE_ON_SHARE_SLUG "${OVERRIDE_ON_ALBUM_ID}" "${OVERRIDE_ON_SHARED_SLUG}" \
    '{"allowDownload":true,"allowUpload":true,"showMetadata":true}'
  create_one_shared_link OVERRIDE_OFF_SHARE_KEY OVERRIDE_OFF_SHARE_SLUG "${OVERRIDE_OFF_ALBUM_ID}" "${OVERRIDE_OFF_SHARED_SLUG}" \
    '{"allowDownload":false,"allowUpload":false,"showMetadata":true}'
  # Same album as override-off; separate link to test metadata flag in isolation.
  create_one_shared_link METADATA_OFF_SHARE_KEY METADATA_OFF_SHARE_SLUG "${OVERRIDE_OFF_ALBUM_ID}" "${METADATA_OFF_SHARED_SLUG}" \
    '{"allowDownload":true,"allowUpload":false,"showMetadata":false}'
  create_one_shared_link PASSWORD_PROTECTED_SHARE_KEY PASSWORD_PROTECTED_SHARE_SLUG "${PASSWORD_PROTECTED_ALBUM_ID}" "${PASSWORD_PROTECTED_SHARED_SLUG}" \
    '{"allowDownload":true,"allowUpload":false,"showMetadata":true}' "${E2E_SHARE_PASSWORD}"
  create_one_shared_link PASSWORD_PROTECTED_B_SHARE_KEY PASSWORD_PROTECTED_B_SHARE_SLUG "${PASSWORD_PROTECTED_B_ALBUM_ID}" "${PASSWORD_PROTECTED_B_SHARED_SLUG}" \
    '{"allowDownload":true,"allowUpload":false,"showMetadata":true}' "${E2E_SHARE_PASSWORD_B}"
}

write_runtime_file() {
  mkdir -p "$(dirname "${RUNTIME_FILE}")"
  cat > "${RUNTIME_FILE}" <<EOF
DEFAULT_SHARE_KEY=${DEFAULT_SHARE_KEY}
DEFAULT_SHARE_SLUG=${DEFAULT_SHARE_SLUG}
OVERRIDE_ON_SHARE_KEY=${OVERRIDE_ON_SHARE_KEY}
OVERRIDE_ON_SHARE_SLUG=${OVERRIDE_ON_SHARE_SLUG}
OVERRIDE_OFF_SHARE_KEY=${OVERRIDE_OFF_SHARE_KEY}
OVERRIDE_OFF_SHARE_SLUG=${OVERRIDE_OFF_SHARE_SLUG}
METADATA_OFF_SHARE_KEY=${METADATA_OFF_SHARE_KEY}
METADATA_OFF_SHARE_SLUG=${METADATA_OFF_SHARE_SLUG}
DEFAULT_ALBUM_ID=${DEFAULT_ALBUM_ID}
OVERRIDE_ON_ALBUM_ID=${OVERRIDE_ON_ALBUM_ID}
OVERRIDE_OFF_ALBUM_ID=${OVERRIDE_OFF_ALBUM_ID}
PRIVATE_ALBUM_ID=${PRIVATE_ALBUM_ID}
PASSWORD_PROTECTED_SHARE_KEY=${PASSWORD_PROTECTED_SHARE_KEY}
PASSWORD_PROTECTED_SHARE_SLUG=${PASSWORD_PROTECTED_SHARE_SLUG}
PASSWORD_PROTECTED_ALBUM_ID=${PASSWORD_PROTECTED_ALBUM_ID}
PASSWORD_PROTECTED_ASSET_ID=${PASSWORD_PROTECTED_ASSET_ID}
PASSWORD_PROTECTED_B_SHARE_KEY=${PASSWORD_PROTECTED_B_SHARE_KEY}
PASSWORD_PROTECTED_B_SHARE_SLUG=${PASSWORD_PROTECTED_B_SHARE_SLUG}
PASSWORD_PROTECTED_B_ALBUM_ID=${PASSWORD_PROTECTED_B_ALBUM_ID}
PASSWORD_PROTECTED_B_ASSET_ID=${PASSWORD_PROTECTED_B_ASSET_ID}
E2E_SHARE_PASSWORD=${E2E_SHARE_PASSWORD}
E2E_SHARE_PASSWORD_B=${E2E_SHARE_PASSWORD_B}
ASSET_ID=${ASSET_ID}
FIRST_ASSET_ID=${FIRST_ASSET_ID}
VIDEO_ASSET_ID=${VIDEO_ASSET_ID}
EXPECTED_ASSET_COUNT=${EXPECTED_ASSET_COUNT}
EOF
}

main() {
  wait_for_immich
  create_admin
  login_admin
  generate_seed_media
  upload_seed_assets
  create_test_albums
  create_private_album
  create_password_protected_album
  create_password_protected_album_b
  create_shared_links
  write_runtime_file

  log "Seed complete"
  log "Default share key: ${DEFAULT_SHARE_KEY}"
  log "Default share slug: ${DEFAULT_SHARE_SLUG}"
  log "Assets: ${EXPECTED_ASSET_COUNT} (video: ${VIDEO_ASSET_ID})"
  log "Runtime file: ${RUNTIME_FILE}"
}

main "$@"
