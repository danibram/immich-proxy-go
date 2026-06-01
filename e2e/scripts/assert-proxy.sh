#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BASE_URL="${BASE_URL:-}"
PROXY_NAME="${PROXY_NAME:-proxy}"
SEED_FILE="${SEED_FILE:-/runtime/seed.env}"
EXPECT_DOWNLOAD_STATUS="${EXPECT_DOWNLOAD_STATUS:-200}"
EXPECT_METADATA_VISIBLE="${EXPECT_METADATA_VISIBLE:-true}"
SKIP_UPLOAD_TESTS="${SKIP_UPLOAD_TESTS:-false}"

if [[ -z "${BASE_URL}" ]]; then
  echo "[assert][error] BASE_URL is required" >&2
  exit 1
fi

if [[ ! -f "${SEED_FILE}" ]]; then
  echo "[assert][error] Missing seed file: ${SEED_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${SEED_FILE}"

log() {
  printf '[assert][%s] %s\n' "${PROXY_NAME}" "$*"
}

die() {
  printf '[assert][%s][error] %s\n' "${PROXY_NAME}" "$*" >&2
  exit 1
}

wait_for_proxy() {
  log "Waiting for ${BASE_URL}/healthcheck"
  local attempt=0
  local max_attempts=60
  until curl -sS -f "${BASE_URL}/healthcheck" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if (( attempt >= max_attempts )); then
      die "Reverse proxy did not become ready"
    fi
    sleep 2
  done
}

assert_status() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  if [[ "${expected}" != "${actual}" ]]; then
    die "${label}: expected HTTP ${expected}, got ${actual}"
  fi
}

assert_non_empty_file() {
  local file_path="$1"
  local label="$2"
  if [[ ! -s "${file_path}" ]]; then
    die "${label}: expected non-empty file ${file_path}"
  fi
}

create_upload_png() {
  cat > /tmp/upload.base64 <<'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WfD7asAAAAASUVORK5CYII=
EOF
  base64 -d /tmp/upload.base64 > /tmp/upload.png
}

require_seed_vars() {
  [[ -n "${DEFAULT_SHARE_KEY}" ]] || die "Missing DEFAULT_SHARE_KEY in seed file"
  [[ -n "${DEFAULT_SHARE_SLUG}" ]] || die "Missing DEFAULT_SHARE_SLUG in seed file"
  [[ -n "${DEFAULT_ALBUM_ID}" ]] || die "Missing DEFAULT_ALBUM_ID in seed file"
  [[ -n "${OVERRIDE_ON_SHARE_KEY}" ]] || die "Missing OVERRIDE_ON_SHARE_KEY in seed file"
  [[ -n "${OVERRIDE_OFF_SHARE_KEY}" ]] || die "Missing OVERRIDE_OFF_SHARE_KEY in seed file"
  [[ -n "${METADATA_OFF_SHARE_KEY}" ]] || die "Missing METADATA_OFF_SHARE_KEY in seed file"
  [[ -n "${PASSWORD_PROTECTED_SHARE_SLUG}" ]] || die "Missing PASSWORD_PROTECTED_SHARE_SLUG in seed file"
  [[ -n "${PASSWORD_PROTECTED_ASSET_ID}" ]] || die "Missing PASSWORD_PROTECTED_ASSET_ID in seed file"
  [[ -n "${E2E_SHARE_PASSWORD}" ]] || die "Missing E2E_SHARE_PASSWORD in seed file"
}

extract_public_asset_id() {
  local json_file="$1"
  local asset_id
  asset_id="$(jq -r '.album.assets[0].id // .assets[0].id // empty' "${json_file}")"
  if [[ -z "${asset_id}" ]]; then
    asset_id="${ASSET_ID:-}"
  fi
  if [[ -z "${asset_id}" ]]; then
    die "Could not determine an asset ID exposed by shared link payload ${json_file}"
  fi
  PUBLIC_ASSET_ID="${asset_id}"
}

assert_download_for_share() {
  local share_key="$1"
  local expected_status="$2"
  local label="$3"
  local out_file="$4"
  local attempt=0
  local max_attempts=30
  local status

  while true; do
    status="$(curl -sS -o "${out_file}" -w '%{http_code}' "${BASE_URL}/share/${share_key}/api/assets/${PUBLIC_ASSET_ID}/original")"
    if [[ "${status}" == "${expected_status}" ]]; then
      break
    fi
    attempt=$((attempt + 1))
    if (( attempt >= max_attempts )); then
      die "${label}: expected HTTP ${expected_status}, got ${status} after ${max_attempts} attempts"
    fi
    sleep 2
  done

  if [[ "${expected_status}" == "200" ]]; then
    assert_non_empty_file "${out_file}" "${label}"
  fi
}

assert_metadata_for_share() {
  local share_key="$1"
  local expected_visible="$2"
  local expected_show_metadata="$3"
  local label="$4"
  local out_file="$5"
  local attempts=0
  local max_attempts=30
  local status

  while true; do
    status="$(curl -sS -o "${out_file}" -w '%{http_code}' "${BASE_URL}/share/${share_key}/api/shared-links/me")"
    assert_status "200" "${status}" "${label} shared-links/me"

    if [[ -n "${expected_show_metadata}" ]]; then
      jq -e --argjson expected "${expected_show_metadata}" '.showMetadata == $expected' "${out_file}" >/dev/null || die "${label}: unexpected showMetadata flag"
    fi

    if [[ "${expected_visible}" == "true" ]]; then
      if jq -e '(.album.assets[0].exifInfo // .assets[0].exifInfo) != null' "${out_file}" >/dev/null; then
        break
      fi
      attempts=$((attempts + 1))
      if (( attempts >= max_attempts )); then
        die "${label}: expected EXIF visible but still missing after ${max_attempts} attempts"
      fi
      sleep 2
    else
      jq -e '(.album.assets[0].exifInfo // .assets[0].exifInfo) == null' "${out_file}" >/dev/null || die "${label}: expected EXIF hidden"
      break
    fi
  done
}

assert_upload_for_share() {
  local share_key="$1"
  local expected_mode="$2" # allow|deny
  local label="$3"
  local out_file="$4"
  local filename_suffix="$5"

  create_upload_png
  local now_iso
  now_iso="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local status
  status="$(curl -sS \
    -X POST \
    -F "assetData=@/tmp/upload.png;type=image/png;filename=assert-${filename_suffix}.png" \
    -F "deviceId=e2e-assert-device-${filename_suffix}" \
    -F "deviceAssetId=e2e-assert-${filename_suffix}-$(date -u +%s)" \
    -F "fileCreatedAt=${now_iso}" \
    -F "fileModifiedAt=${now_iso}" \
    -o "${out_file}" \
    -w '%{http_code}' \
    "${BASE_URL}/share/${share_key}/api/assets")"

  if [[ "${expected_mode}" == "allow" ]]; then
    if [[ "${status}" != "201" && "${status}" != "200" ]]; then
      cat "${out_file}" >&2 || true
      die "${label}: expected HTTP 200/201, got ${status}"
    fi
    return
  fi

  assert_status "403" "${status}" "${label}"
}

assert_json_password_required() {
  local json_file="$1"
  local label="$2"
  jq -e '.passwordRequired == true' "${json_file}" >/dev/null || die "${label}: expected passwordRequired=true"
}

sign_share_password_cookie() {
  local password="$1"
  case "${password}" in
    stale-password-from-another-share)
      # Must match proxy/internal/sharecookie/cookie_test.go TestSign_e2eStalePasswordVector
      printf '%s' 'c3RhbGUtcGFzc3dvcmQtZnJvbS1hbm90aGVyLXNoYXJl.z3XQleAhHpf-MgTQS9fgvqCyrYCNK0g6TIeUBMgp0T0='
      ;;
    *)
      die "unsupported password for e2e cookie signing: ${password}"
      ;;
  esac
}

assert_stale_password_media_performance() {
  local public_slug="$1"
  local public_key="$2"
  local stale_password="stale-password-from-another-share"
  local signed_cookie public_asset_id status
  local thumb_headers=(
    -H "Sec-Fetch-Dest: image"
    -H "Sec-Fetch-Site: same-origin"
  )

  log "media perf: resolve a public share asset id"
  status="$(curl -sS -o /tmp/public-share-for-media-perf.json -w '%{http_code}' \
    "${BASE_URL}/share/${public_key}/api/shared-links/me")"
  assert_status "200" "${status}" "public shared-links/me baseline"
  extract_public_asset_id /tmp/public-share-for-media-perf.json
  public_asset_id="${PUBLIC_ASSET_ID}"

  signed_cookie="$(sign_share_password_cookie "${stale_password}")"
  [[ -n "${signed_cookie}" ]] || die "failed to sign stale password cookie"

  log "media perf: slug thumbnail with stale cookie must not retry without password (expect 400/404, not 200)"
  status="$(curl -sS \
    "${thumb_headers[@]}" \
    -H "Referer: ${BASE_URL}/s/${public_slug}" \
    -b "immich-share-password=${signed_cookie}" \
    -o /tmp/public-stale-thumb-direct.bin \
    -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/assets/${public_asset_id}/thumbnail?size=preview")"
  if [[ "${status}" == "200" ]]; then
    die "slug thumbnail with stale password cookie must not succeed without clearing cookie first (got 200 — media retry still active?)"
  fi
  if [[ "${status}" != "400" && "${status}" != "404" ]]; then
    die "slug thumbnail with stale password cookie: expected HTTP 400 or 404, got ${status}"
  fi

  log "media perf: shared-links/me clears stale password cookie"
  rm -f /tmp/public-stale-media.cookies
  status="$(curl -sS \
    -b "immich-share-password=${signed_cookie}" \
    -c /tmp/public-stale-media.cookies \
    -D /tmp/public-stale-media-headers.txt \
    -o /tmp/public-stale-media-share.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/shared-links/me")"
  assert_status "200" "${status}" "public shared-links/me with stale password cookie"
  jq -e '.type == "ALBUM"' /tmp/public-stale-media-share.json >/dev/null || die "public share payload missing after stale password cookie"
  grep -qi 'immich-share-password' /tmp/public-stale-media-headers.txt || die "expected Set-Cookie clearing stale password"
  grep -Eiq 'Max-Age=0|Expires=Thu, 01 Jan 1970' /tmp/public-stale-media-headers.txt || die "expected stale password cookie deletion (Max-Age=0)"

  log "media perf: cleared cookie jar no longer sends stale password on shared-links/me"
  status="$(curl -sS \
    -b /tmp/public-stale-media.cookies \
    -o /tmp/public-stale-media-share-followup.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/shared-links/me")"
  assert_status "200" "${status}" "public shared-links/me after stale cookie cleared"
  jq -e '.type == "ALBUM"' /tmp/public-stale-media-share-followup.json >/dev/null || die "public share payload missing after stale cookie cleared"

  log "media perf OK"
}

assert_password_protection() {
  local protected_slug="$1"
  local password="$2"
  local _asset_id="$3"
  local public_slug="$4"
  local status

  log "password protection: unauthenticated shared-links/me is rejected"
  status="$(curl -sS -o /tmp/password-protected-unauth.json -w '%{http_code}' \
    "${BASE_URL}/s/${protected_slug}/api/shared-links/me")"
  assert_status "401" "${status}" "protected shared-links/me without password"
  assert_json_password_required /tmp/password-protected-unauth.json "protected shared-links/me without password"

  log "password protection: wrong password header is rejected"
  status="$(curl -sS \
    -H "X-Immich-Share-Password: definitely-wrong-password" \
    -o /tmp/password-protected-wrong-header.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_slug}/api/shared-links/me")"
  assert_status "401" "${status}" "protected shared-links/me with wrong header password"
  assert_json_password_required /tmp/password-protected-wrong-header.json "protected shared-links/me with wrong header password"

  log "password protection: thumbnail blocked before unlock"
  status="$(curl -sS -o /tmp/password-protected-thumb-unauth.bin -w '%{http_code}' \
    "${BASE_URL}/s/${protected_slug}/api/assets/${_asset_id}/thumbnail?size=preview")"
  if [[ "${status}" != "401" && "${status}" != "404" ]]; then
    die "protected thumbnail without password: expected HTTP 401 or 404, got ${status}"
  fi

  log "password protection: wrong POST password is rejected"
  status="$(curl -sS \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"password":"wrong-password"}' \
    -o /tmp/password-protected-wrong-post.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_slug}/api/shared-links/me/password")"
  assert_status "401" "${status}" "protected password validation wrong password"

  log "password protection: correct password unlocks API + sets scoped cookie"
  rm -f /tmp/password-protected.cookies
  status="$(curl -sS \
    -X POST \
    -H "Content-Type: application/json" \
    -c /tmp/password-protected.cookies \
    -D /tmp/password-protected-set-cookie.headers \
    -d "{\"password\":\"${password}\"}" \
    -o /tmp/password-protected-valid-post.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_slug}/api/shared-links/me/password")"
  assert_status "200" "${status}" "protected password validation correct password"
  jq -e '.valid == true' /tmp/password-protected-valid-post.json >/dev/null || die "protected password validation should return valid=true"
  grep -qi "immich-share-password" /tmp/password-protected-set-cookie.headers || die "protected password validation must set immich-share-password cookie"
  grep -qi "Path=/s/${protected_slug}" /tmp/password-protected-set-cookie.headers || die "password cookie must be scoped to /s/${protected_slug}"

  status="$(curl -sS \
    -b /tmp/password-protected.cookies \
    -o /tmp/password-protected-auth.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_slug}/api/shared-links/me")"
  assert_status "200" "${status}" "protected shared-links/me with unlocked cookie"
  jq -e '.type == "ALBUM"' /tmp/password-protected-auth.json >/dev/null || die "protected shared link payload missing after unlock"

  local unlocked_asset_id
  unlocked_asset_id="$(jq -r '.album.assets[0].id // .assets[0].id // empty' /tmp/password-protected-auth.json)"
  [[ -n "${unlocked_asset_id}" ]] || die "protected shared link payload did not expose an asset id after unlock"

  local attempt=0
  local max_attempts=30
  while (( attempt < max_attempts )); do
    status="$(curl -sS \
      -b /tmp/password-protected.cookies \
      -o /tmp/password-protected-thumb-auth.bin \
      -w '%{http_code}' \
      "${BASE_URL}/s/${protected_slug}/api/assets/${unlocked_asset_id}/thumbnail?size=preview")"
    if [[ "${status}" == "200" ]]; then
      break
    fi
    attempt=$((attempt + 1))
    if (( attempt >= max_attempts )); then
      die "protected thumbnail after unlock: expected HTTP 200, got ${status} after ${max_attempts} attempts"
    fi
    sleep 2
  done
  assert_non_empty_file /tmp/password-protected-thumb-auth.bin "protected thumbnail after unlock"

  log "password protection: stale password on public share still loads"
  status="$(curl -sS \
    -H "X-Immich-Share-Password: stale-password-from-another-share" \
    -o /tmp/public-stale-password.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/shared-links/me")"
  assert_status "200" "${status}" "public shared-links/me with stale password header"
  jq -e '.type == "ALBUM"' /tmp/public-stale-password.json >/dev/null || die "public share should still load with stale password header"

  log "password protection: scoped cookie is not sent to public slug"
  status="$(curl -sS \
    -b /tmp/password-protected.cookies \
    -o /tmp/public-with-protected-cookie-jar.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/shared-links/me")"
  assert_status "200" "${status}" "public shared-links/me remains accessible"
  jq -e '.type == "ALBUM"' /tmp/public-with-protected-cookie-jar.json >/dev/null || die "public share payload missing when protected cookie jar is present but scoped away"

  log "password protection: protected slug still requires auth in a fresh session"
  status="$(curl -sS -o /tmp/password-protected-fresh-session.json -w '%{http_code}' \
    "${BASE_URL}/s/${protected_slug}/api/shared-links/me")"
  assert_status "401" "${status}" "protected shared-links/me fresh session"
  assert_json_password_required /tmp/password-protected-fresh-session.json "protected shared-links/me fresh session"

  log "password protection OK"
}

main() {
  require_seed_vars
  wait_for_proxy

  local status
  status="$(curl -sS -o /tmp/health.txt -w '%{http_code}' "${BASE_URL}/healthcheck")"
  assert_status "200" "${status}" "healthcheck"
  log "healthcheck OK"

  status="$(curl -sS -o /tmp/share-page.html -w '%{http_code}' "${BASE_URL}/share/${DEFAULT_SHARE_KEY}")"
  assert_status "200" "${status}" "share page"
  grep -qi "immich" /tmp/share-page.html || die "share page does not look like proxy UI"
  log "share page OK"

  status="$(curl -sS -o /tmp/shared-link-default.json -w '%{http_code}' "${BASE_URL}/share/${DEFAULT_SHARE_KEY}/api/shared-links/me")"
  assert_status "200" "${status}" "shared-links/me default"
  jq -e '.type == "ALBUM"' /tmp/shared-link-default.json >/dev/null || die "default shared link type is not ALBUM"
  jq -e --arg album_id "${DEFAULT_ALBUM_ID}" '.album.id == $album_id' /tmp/shared-link-default.json >/dev/null || die "default shared link album ID mismatch"
  jq -e '.userId == ""' /tmp/shared-link-default.json >/dev/null || die "default share userId not sanitized"
  jq -e '.token == "" or .token == null' /tmp/shared-link-default.json >/dev/null || die "default share token not sanitized"
  jq -e '.password == "" or .password == null' /tmp/shared-link-default.json >/dev/null || die "default share password not sanitized"
  jq -e '.album.owner == null' /tmp/shared-link-default.json >/dev/null || die "default share album owner should be redacted"
  extract_public_asset_id /tmp/shared-link-default.json

  local default_allow_download default_allow_upload default_show_metadata
  default_allow_download="$(jq -r '.allowDownload' /tmp/shared-link-default.json)"
  default_allow_upload="$(jq -r '.allowUpload' /tmp/shared-link-default.json)"
  default_show_metadata="$(jq -r '.showMetadata' /tmp/shared-link-default.json)"

  status="$(curl -sS -o /tmp/shared-link-override-on.json -w '%{http_code}' "${BASE_URL}/share/${OVERRIDE_ON_SHARE_KEY}/api/shared-links/me")"
  assert_status "200" "${status}" "shared-links/me override-on"
  jq -e --arg album_id "${OVERRIDE_ON_ALBUM_ID}" '.album.id == $album_id' /tmp/shared-link-override-on.json >/dev/null || die "override-on album ID mismatch"
  local expected_override_on_download expected_override_on_metadata global_dl global_md
  global_dl="false"
  global_md="false"
  e2e_global_download_enabled && global_dl="true"
  e2e_global_metadata_enabled && global_md="true"
  expected_override_on_download="$(effective_bool "${global_dl}" "true")"
  expected_override_on_metadata="$(effective_bool "${global_md}" "true")"
  jq -e \
    --argjson allow_download "${expected_override_on_download}" \
    --argjson show_metadata "${expected_override_on_metadata}" \
    '.allowDownload == $allow_download and .allowUpload == true and .showMetadata == $show_metadata' \
    /tmp/shared-link-override-on.json >/dev/null || die "override-on effective flags mismatch"

  status="$(curl -sS -o /tmp/shared-link-override-off.json -w '%{http_code}' "${BASE_URL}/share/${OVERRIDE_OFF_SHARE_KEY}/api/shared-links/me")"
  assert_status "200" "${status}" "shared-links/me override-off"
  jq -e --arg album_id "${OVERRIDE_OFF_ALBUM_ID}" '.album.id == $album_id' /tmp/shared-link-override-off.json >/dev/null || die "override-off album ID mismatch"
  jq -e '.allowDownload == false and .allowUpload == false' /tmp/shared-link-override-off.json >/dev/null || die "override-off download/upload flags mismatch"

  status="$(curl -sS -o /tmp/shared-link-metadata-off.json -w '%{http_code}' "${BASE_URL}/share/${METADATA_OFF_SHARE_KEY}/api/shared-links/me")"
  assert_status "200" "${status}" "shared-links/me metadata-off"
  jq -e --arg album_id "${OVERRIDE_OFF_ALBUM_ID}" '.album.id == $album_id' /tmp/shared-link-metadata-off.json >/dev/null || die "metadata-off album ID mismatch"
  jq -e '.showMetadata == false' /tmp/shared-link-metadata-off.json >/dev/null || die "metadata-off showMetadata flag mismatch"
  log "shared link defaults + overrides API OK"

  status="$(curl -sS -o /tmp/album-default.json -w '%{http_code}' "${BASE_URL}/share/${DEFAULT_SHARE_KEY}/api/albums/${DEFAULT_ALBUM_ID}")"
  assert_status "200" "${status}" "default album endpoint"
  jq -e --arg album_id "${DEFAULT_ALBUM_ID}" '.id == $album_id' /tmp/album-default.json >/dev/null || die "default album endpoint mismatch"
  log "album endpoint OK"

  local expected_default_download_status
  expected_default_download_status="$(expected_download_status_for_link "${default_allow_download}")"
  assert_download_for_share "${DEFAULT_SHARE_KEY}" "${expected_default_download_status}" "default share download behavior" "/tmp/default-original.bin"
  assert_download_for_share "${OVERRIDE_ON_SHARE_KEY}" "${EXPECT_DOWNLOAD_STATUS}" "override-on share download behavior" "/tmp/override-on-original.bin"
  assert_download_for_share "${OVERRIDE_OFF_SHARE_KEY}" "403" "override-off share download behavior" "/tmp/override-off-original.bin"
  log "download behavior (defaults + overrides) OK"

  local expected_default_metadata_visible
  expected_default_metadata_visible="$(expected_metadata_visible_for_link "${default_show_metadata}")"
  assert_metadata_for_share "${DEFAULT_SHARE_KEY}" "${expected_default_metadata_visible}" "${default_show_metadata}" "default share metadata behavior" "/tmp/default-metadata.json"
  local override_on_show_metadata
  override_on_show_metadata="$(jq -r '.showMetadata' /tmp/shared-link-override-on.json)"
  assert_metadata_for_share "${OVERRIDE_ON_SHARE_KEY}" "${EXPECT_METADATA_VISIBLE}" "${override_on_show_metadata}" "override-on share metadata behavior" "/tmp/override-on-metadata.json"
  assert_metadata_for_share "${METADATA_OFF_SHARE_KEY}" "false" "false" "metadata-off share metadata behavior" "/tmp/metadata-off-metadata.json"
  log "metadata behavior (defaults + overrides) OK"

  if [[ "${SKIP_UPLOAD_TESTS}" != "true" ]]; then
    if [[ "${default_allow_upload}" == "true" ]]; then
      assert_upload_for_share "${DEFAULT_SHARE_KEY}" "allow" "default share upload behavior" "/tmp/upload-default.json" "default"
    else
      assert_upload_for_share "${DEFAULT_SHARE_KEY}" "deny" "default share upload behavior" "/tmp/upload-default.json" "default"
    fi
    assert_upload_for_share "${OVERRIDE_ON_SHARE_KEY}" "allow" "override-on share upload behavior" "/tmp/upload-override-on.json" "override-on"
    assert_upload_for_share "${OVERRIDE_OFF_SHARE_KEY}" "deny" "override-off share upload behavior" "/tmp/upload-override-off.json" "override-off"
    log "upload behavior (defaults + overrides) OK"
  fi

  status="$(curl -sS -o /tmp/private-album.txt -w '%{http_code}' "${BASE_URL}/share/${DEFAULT_SHARE_KEY}/api/albums/${PRIVATE_ALBUM_ID}")"
  assert_status "404" "${status}" "private album should not be reachable from public share"
  log "private album isolation OK"

  status="$(curl -sS -o /tmp/not-found.txt -w '%{http_code}' "${BASE_URL}/share/invalidsharekey123/api/shared-links/me")"
  assert_status "404" "${status}" "invalid key behavior"
  log "invalid key behavior OK"

  assert_password_protection "${PASSWORD_PROTECTED_SHARE_SLUG}" "${E2E_SHARE_PASSWORD}" "${PASSWORD_PROTECTED_ASSET_ID}" "${DEFAULT_SHARE_SLUG}"
  assert_stale_password_media_performance "${DEFAULT_SHARE_SLUG}" "${DEFAULT_SHARE_KEY}"

  log "All base scenarios passed"
}

main "$@"
