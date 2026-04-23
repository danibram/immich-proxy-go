#!/usr/bin/env bash
set -Eeuo pipefail

IMMICH_BASE_URL="${IMMICH_BASE_URL:-http://immich-server:2283}"
IMMICH_API_URL="${IMMICH_BASE_URL%/}/api"
RUNTIME_FILE="${RUNTIME_FILE:-/runtime/seed.env}"

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
    201)
      log "Admin user created"
      ;;
    400|409)
      log "Admin already exists, continuing"
      ;;
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

create_seed_png() {
  # 1x1 transparent PNG
  cat > /tmp/seed.base64 <<'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WfD7asAAAAASUVORK5CYII=
EOF
  base64 -d /tmp/seed.base64 > /tmp/seed.png
}

upload_asset() {
  local now_iso
  now_iso="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local device_id
  device_id="e2e-device"
  local device_asset_id
  device_asset_id="e2e-asset-$(date -u +%s)"

  local status
  status="$(curl -sS \
    -X POST \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -F "assetData=@/tmp/seed.png;type=image/png;filename=e2e-seed.png" \
    -F "deviceId=${device_id}" \
    -F "deviceAssetId=${device_asset_id}" \
    -F "fileCreatedAt=${now_iso}" \
    -F "fileModifiedAt=${now_iso}" \
    -o /tmp/upload.json \
    -w "%{http_code}" \
    "${IMMICH_API_URL}/assets")"

  if [[ "$status" != "201" && "$status" != "200" ]]; then
    cat /tmp/upload.json >&2 || true
    die "Asset upload failed (status: ${status})"
  fi

  ASSET_ID="$(jq -r '.id // empty' /tmp/upload.json)"
  if [[ -z "${ASSET_ID}" ]]; then
    cat /tmp/upload.json >&2 || true
    die "Upload response did not include an asset ID"
  fi
}

create_album_with_asset() {
  local album_name="$1"
  local album_description="$2"
  local output_file="$3"
  local id_var_name="$4"

  local payload
  payload="$(jq -nc \
    --arg name "${album_name}" \
    --arg description "${album_description}" \
    --arg asset_id "${ASSET_ID}" \
    '{albumName: $name, description: $description, assetIds: [$asset_id]}')"

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

  # Defensive call to ensure the seeded asset is present in the album
  local add_payload
  add_payload="$(jq -nc --arg asset_id "${ASSET_ID}" '{ids: [$asset_id]}')"
  local add_status
  add_status="$(json_request "PUT" "/albums/${album_id}/assets" "${add_payload}" "Authorization: Bearer ${ACCESS_TOKEN}" "/tmp/add-to-album.json")"
  if [[ "$add_status" != "200" ]]; then
    cat /tmp/add-to-album.json >&2 || true
    die "Failed to ensure asset membership in album '${album_name}' (status: ${add_status})"
  fi

  printf -v "${id_var_name}" '%s' "${album_id}"
}

create_test_albums() {
  create_album_with_asset \
    "E2E Default Flags Album" \
    "Album used to validate Immich default shared-link flags" \
    "/tmp/album-default.json" \
    "DEFAULT_ALBUM_ID"

  create_album_with_asset \
    "E2E Override On Album" \
    "Album used to validate explicit override flags set to true" \
    "/tmp/album-override-on.json" \
    "OVERRIDE_ON_ALBUM_ID"

  create_album_with_asset \
    "E2E Override Off Album" \
    "Album used to validate explicit override flags set to false" \
    "/tmp/album-override-off.json" \
    "OVERRIDE_OFF_ALBUM_ID"
}

create_private_album() {
  local payload
  payload="$(jq -nc \
    --arg name "E2E Private Album" \
    --arg description "Album that must NOT be reachable from public share routes" \
    --arg asset_id "${ASSET_ID}" \
    '{albumName: $name, description: $description, assetIds: [$asset_id]}')"

  local status
  status="$(json_request "POST" "/albums" "${payload}" "Authorization: Bearer ${ACCESS_TOKEN}" "/tmp/private-album.json")"
  if [[ "$status" != "201" ]]; then
    cat /tmp/private-album.json >&2 || true
    die "Failed to create private album (status: ${status})"
  fi

  PRIVATE_ALBUM_ID="$(jq -r '.id // empty' /tmp/private-album.json)"
  if [[ -z "${PRIVATE_ALBUM_ID}" ]]; then
    cat /tmp/private-album.json >&2 || true
    die "Private album response did not include an album ID"
  fi
}

create_shared_links() {
  # Shared link for validating Immich defaults (do not pass flag overrides).
  local default_payload
  default_payload="$(jq -nc \
    --arg album_id "${DEFAULT_ALBUM_ID}" \
    --arg slug "${DEFAULT_SHARED_SLUG}" \
    '{
      type: "ALBUM",
      albumId: $album_id,
      slug: $slug
    }')"

  local default_status
  default_status="$(json_request "POST" "/shared-links" "${default_payload}" "Authorization: Bearer ${ACCESS_TOKEN}" "/tmp/shared-link-default.json")"
  if [[ "$default_status" != "201" ]]; then
    cat /tmp/shared-link-default.json >&2 || true
    die "Failed to create default shared link (status: ${default_status})"
  fi

  DEFAULT_SHARE_KEY="$(jq -r '.key // empty' /tmp/shared-link-default.json)"
  DEFAULT_SHARE_SLUG="$(jq -r '.slug // empty' /tmp/shared-link-default.json)"
  if [[ -z "${DEFAULT_SHARE_KEY}" ]]; then
    cat /tmp/shared-link-default.json >&2 || true
    die "Default shared link response did not include key"
  fi

  # Shared link with explicit overrides enabled.
  local override_on_payload
  override_on_payload="$(jq -nc \
    --arg album_id "${OVERRIDE_ON_ALBUM_ID}" \
    --arg slug "${OVERRIDE_ON_SHARED_SLUG}" \
    '{
      type: "ALBUM",
      albumId: $album_id,
      allowDownload: true,
      allowUpload: true,
      showMetadata: true,
      slug: $slug
    }')"

  local override_on_status
  override_on_status="$(json_request "POST" "/shared-links" "${override_on_payload}" "Authorization: Bearer ${ACCESS_TOKEN}" "/tmp/shared-link-override-on.json")"
  if [[ "$override_on_status" != "201" ]]; then
    cat /tmp/shared-link-override-on.json >&2 || true
    die "Failed to create override-on shared link (status: ${override_on_status})"
  fi

  OVERRIDE_ON_SHARE_KEY="$(jq -r '.key // empty' /tmp/shared-link-override-on.json)"
  OVERRIDE_ON_SHARE_SLUG="$(jq -r '.slug // empty' /tmp/shared-link-override-on.json)"
  if [[ -z "${OVERRIDE_ON_SHARE_KEY}" ]]; then
    cat /tmp/shared-link-override-on.json >&2 || true
    die "Override-on shared link response did not include key"
  fi

  # Shared link with explicit overrides disabled.
  local override_off_payload
  override_off_payload="$(jq -nc \
    --arg album_id "${OVERRIDE_OFF_ALBUM_ID}" \
    --arg slug "${OVERRIDE_OFF_SHARED_SLUG}" \
    '{
      type: "ALBUM",
      albumId: $album_id,
      allowDownload: false,
      allowUpload: false,
      showMetadata: true,
      slug: $slug
    }')"

  local override_off_status
  override_off_status="$(json_request "POST" "/shared-links" "${override_off_payload}" "Authorization: Bearer ${ACCESS_TOKEN}" "/tmp/shared-link-override-off.json")"
  if [[ "$override_off_status" != "201" ]]; then
    cat /tmp/shared-link-override-off.json >&2 || true
    die "Failed to create override-off shared link (status: ${override_off_status})"
  fi

  OVERRIDE_OFF_SHARE_KEY="$(jq -r '.key // empty' /tmp/shared-link-override-off.json)"
  OVERRIDE_OFF_SHARE_SLUG="$(jq -r '.slug // empty' /tmp/shared-link-override-off.json)"
  if [[ -z "${OVERRIDE_OFF_SHARE_KEY}" ]]; then
    cat /tmp/shared-link-override-off.json >&2 || true
    die "Override-off shared link response did not include key"
  fi

  # Dedicated shared link to validate explicit metadata override=false.
  # Keep allowDownload=true here to avoid Immich variants that may force
  # showMetadata=true when allowDownload=false.
  local metadata_off_payload
  metadata_off_payload="$(jq -nc \
    --arg album_id "${OVERRIDE_OFF_ALBUM_ID}" \
    --arg slug "${METADATA_OFF_SHARED_SLUG}" \
    '{
      type: "ALBUM",
      albumId: $album_id,
      allowDownload: true,
      allowUpload: false,
      showMetadata: false,
      slug: $slug
    }')"

  local metadata_off_status
  metadata_off_status="$(json_request "POST" "/shared-links" "${metadata_off_payload}" "Authorization: Bearer ${ACCESS_TOKEN}" "/tmp/shared-link-metadata-off.json")"
  if [[ "$metadata_off_status" != "201" ]]; then
    cat /tmp/shared-link-metadata-off.json >&2 || true
    die "Failed to create metadata-off shared link (status: ${metadata_off_status})"
  fi

  METADATA_OFF_SHARE_KEY="$(jq -r '.key // empty' /tmp/shared-link-metadata-off.json)"
  METADATA_OFF_SHARE_SLUG="$(jq -r '.slug // empty' /tmp/shared-link-metadata-off.json)"
  if [[ -z "${METADATA_OFF_SHARE_KEY}" ]]; then
    cat /tmp/shared-link-metadata-off.json >&2 || true
    die "Metadata-off shared link response did not include key"
  fi
}

write_runtime_file() {
  mkdir -p "$(dirname "${RUNTIME_FILE}")"
  cat > "${RUNTIME_FILE}" <<EOF
SHARE_KEY=${DEFAULT_SHARE_KEY}
SHARE_SLUG=${DEFAULT_SHARE_SLUG}
ALBUM_ID=${DEFAULT_ALBUM_ID}
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
ASSET_ID=${ASSET_ID}
EOF
}

main() {
  wait_for_immich
  create_admin
  login_admin
  create_seed_png
  upload_asset
  create_test_albums
  create_private_album
  create_shared_links
  write_runtime_file

  log "Seed complete"
  log "Default share key: ${DEFAULT_SHARE_KEY}"
  log "Default share slug: ${DEFAULT_SHARE_SLUG}"
  log "Override-on share key: ${OVERRIDE_ON_SHARE_KEY}"
  log "Override-on share slug: ${OVERRIDE_ON_SHARE_SLUG}"
  log "Override-off share key: ${OVERRIDE_OFF_SHARE_KEY}"
  log "Override-off share slug: ${OVERRIDE_OFF_SHARE_SLUG}"
  log "Metadata-off share key: ${METADATA_OFF_SHARE_KEY}"
  log "Metadata-off share slug: ${METADATA_OFF_SHARE_SLUG}"
  log "Runtime file: ${RUNTIME_FILE}"
}

main "$@"
