#!/usr/bin/env bash
# Share security matrix — loaded by assert-proxy.sh (expects log, die, assert_status, etc.)

assert_not_server_error() {
  local status="$1"
  local label="$2"
  if [[ "${status}" =~ ^5 ]]; then
    die "${label}: unexpected server error HTTP ${status}"
  fi
}

assert_json_password_required() {
  local json_file="$1"
  local label="$2"
  jq -e '.passwordRequired == true' "${json_file}" >/dev/null || die "${label}: expected passwordRequired=true"
}

sign_stale_password_cookie() {
  # Must match proxy/internal/sharecookie/cookie_test.go TestSign_e2eStalePasswordVector
  printf '%s' 'c3RhbGUtcGFzc3dvcmQtZnJvbS1hbm90aGVyLXNoYXJl.z3XQleAhHpf-MgTQS9fgvqCyrYCNK0g6TIeUBMgp0T0='
}

unlock_share_to_jar() {
  local slug="$1"
  local password="$2"
  local jar="$3"
  local status
  status="$(curl -sS \
    -X POST \
    -H "Content-Type: application/json" \
    -c "${jar}" \
    -d "{\"password\":\"${password}\"}" \
    -o /tmp/unlock-"${slug}".json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${slug}/api/shared-links/me/password")"
  assert_status "200" "${status}" "unlock ${slug}"
  jq -e '.valid == true' /tmp/unlock-"${slug}".json >/dev/null || die "unlock ${slug} should return valid=true"
}

assert_protected_share_blocked() {
  local slug="$1"
  local label="$2"
  local status

  log "security: ${label} — shared-links/me without auth returns 401"
  status="$(curl -sS -o /tmp/sec-"${slug}"-unauth.json -w '%{http_code}' \
    "${BASE_URL}/s/${slug}/api/shared-links/me")"
  assert_not_server_error "${status}" "${label} shared-links/me without auth"
  assert_status "401" "${status}" "${label} shared-links/me without auth"
  assert_json_password_required /tmp/sec-"${slug}"-unauth.json "${label} shared-links/me without auth"

  log "security: ${label} — wrong password header returns 401"
  status="$(curl -sS \
    -H "X-Immich-Share-Password: definitely-wrong-password" \
    -o /tmp/sec-"${slug}"-wrong-header.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${slug}/api/shared-links/me")"
  assert_not_server_error "${status}" "${label} shared-links/me wrong header"
  assert_status "401" "${status}" "${label} shared-links/me wrong header"

  log "security: ${label} — share page HTML is not a server error"
  status="$(curl -sS -o /tmp/sec-"${slug}"-page.html -w '%{http_code}' \
    "${BASE_URL}/s/${slug}")"
  assert_not_server_error "${status}" "${label} share page"
  assert_status "200" "${status}" "${label} share page"
}

assert_share_security_matrix() {
  local public_slug="$1"
  local public_key="$2"
  local protected_a_slug="$3"
  local protected_a_password="$4"
  local protected_b_slug="$5"
  local protected_b_password="$6"
  local protected_asset_id="$7"
  local status attempt max_attempts=30
  local thumb_headers=(
    -H "Sec-Fetch-Dest: image"
    -H "Sec-Fetch-Site: same-origin"
  )

  log "=== share security matrix ==="

  # --- Public album happy path (no auth required) ---
  log "security: public share page loads without server error"
  status="$(curl -sS -o /tmp/sec-public-page.html -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}")"
  assert_not_server_error "${status}" "public share page"
  assert_status "200" "${status}" "public share page"
  grep -qi "immich" /tmp/sec-public-page.html || die "public share page missing UI shell"

  log "security: public shared-links/me without credentials"
  status="$(curl -sS -o /tmp/sec-public-api.json -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/shared-links/me")"
  assert_not_server_error "${status}" "public shared-links/me"
  assert_status "200" "${status}" "public shared-links/me"
  jq -e '.type == "ALBUM"' /tmp/sec-public-api.json >/dev/null || die "public shared-links/me missing album payload"

  log "security: public shared-links/me via key route"
  status="$(curl -sS -o /tmp/sec-public-key-api.json -w '%{http_code}' \
    "${BASE_URL}/share/${public_key}/api/shared-links/me")"
  assert_not_server_error "${status}" "public shared-links/me (key route)"
  assert_status "200" "${status}" "public shared-links/me (key route)"

  # --- Protected albums cannot be accessed directly ---
  assert_protected_share_blocked "${protected_a_slug}" "protected album A"
  assert_protected_share_blocked "${protected_b_slug}" "protected album B"

  log "security: protected A thumbnail blocked without auth"
  status="$(curl -sS \
    "${thumb_headers[@]}" \
    -H "Referer: ${BASE_URL}/s/${protected_a_slug}" \
    -o /tmp/sec-protected-a-thumb-unauth.bin \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_a_slug}/api/assets/${protected_asset_id}/thumbnail?size=preview")"
  assert_not_server_error "${status}" "protected A thumbnail without auth"
  if [[ "${status}" == "200" ]]; then
    die "protected A thumbnail without auth must not return 200"
  fi

  # The CDN-friendly extensioned route must enforce the same auth as the
  # legacy extensionless one (the extension changes cache eligibility only).
  log "security: protected A extensioned thumbnail blocked without auth"
  status="$(curl -sS \
    "${thumb_headers[@]}" \
    -H "Referer: ${BASE_URL}/s/${protected_a_slug}" \
    -o /tmp/sec-protected-a-thumb-ext-unauth.bin \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_a_slug}/api/assets/${protected_asset_id}/thumbnail.jpg?size=preview")"
  assert_not_server_error "${status}" "protected A extensioned thumbnail without auth"
  if [[ "${status}" == "200" ]]; then
    die "protected A extensioned thumbnail without auth must not return 200"
  fi

  log "security: wrong POST password rejected for protected A"
  status="$(curl -sS \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"password":"wrong-password"}' \
    -o /tmp/sec-protected-a-wrong-post.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_a_slug}/api/shared-links/me/password")"
  assert_not_server_error "${status}" "protected A wrong POST password"
  assert_status "401" "${status}" "protected A wrong POST password"

  # --- Cross-album password isolation ---
  log "security: album A password header does not unlock album B"
  status="$(curl -sS \
    -H "X-Immich-Share-Password: ${protected_a_password}" \
    -o /tmp/sec-a-pass-on-b.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_b_slug}/api/shared-links/me")"
  assert_not_server_error "${status}" "album A password on album B API"
  assert_status "401" "${status}" "album A password on album B API"
  assert_json_password_required /tmp/sec-a-pass-on-b.json "album A password on album B API"

  log "security: album B password header does not unlock album A"
  status="$(curl -sS \
    -H "X-Immich-Share-Password: ${protected_b_password}" \
    -o /tmp/sec-b-pass-on-a.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_a_slug}/api/shared-links/me")"
  assert_not_server_error "${status}" "album B password on album A API"
  assert_status "401" "${status}" "album B password on album A API"

  log "security: unlock album A does not unlock album B (scoped cookies)"
  rm -f /tmp/sec-album-a.cookies /tmp/sec-album-b.cookies
  unlock_share_to_jar "${protected_a_slug}" "${protected_a_password}" /tmp/sec-album-a.cookies

  status="$(curl -sS \
    -b /tmp/sec-album-a.cookies \
    -o /tmp/sec-b-after-a-unlock.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_b_slug}/api/shared-links/me")"
  assert_not_server_error "${status}" "album B after A unlocked in same jar"
  assert_status "401" "${status}" "album B after A unlocked in same jar"
  assert_json_password_required /tmp/sec-b-after-a-unlock.json "album B after A unlocked in same jar"

  log "security: scoped cookie for A is not sent to public slug"
  status="$(curl -sS \
    -b /tmp/sec-album-a.cookies \
    -o /tmp/sec-public-with-a-cookie.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/shared-links/me")"
  assert_not_server_error "${status}" "public slug with A cookie jar present"
  assert_status "200" "${status}" "public slug with A cookie jar present"
  jq -e '.type == "ALBUM"' /tmp/sec-public-with-a-cookie.json >/dev/null || die "public share broken when A cookie jar present"

  log "security: unlock album B with its own password"
  unlock_share_to_jar "${protected_b_slug}" "${protected_b_password}" /tmp/sec-album-b.cookies
  status="$(curl -sS \
    -b /tmp/sec-album-b.cookies \
    -o /tmp/sec-b-unlocked.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_b_slug}/api/shared-links/me")"
  assert_not_server_error "${status}" "album B unlocked"
  assert_status "200" "${status}" "album B unlocked"

  log "security: album A still requires auth in a fresh session"
  status="$(curl -sS -o /tmp/sec-a-fresh.json -w '%{http_code}' \
    "${BASE_URL}/s/${protected_a_slug}/api/shared-links/me")"
  assert_status "401" "${status}" "album A fresh session"
  assert_json_password_required /tmp/sec-a-fresh.json "album A fresh session"

  # --- Stale password on public share ---
  log "security: stale password header on public share still loads"
  status="$(curl -sS \
    -H "X-Immich-Share-Password: stale-password-from-another-share" \
    -o /tmp/sec-public-stale-header.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/shared-links/me")"
  assert_not_server_error "${status}" "public share with stale password header"
  assert_status "200" "${status}" "public share with stale password header"

  local signed_stale public_asset_id
  signed_stale="$(sign_stale_password_cookie)"
  status="$(curl -sS -o /tmp/sec-public-asset-source.json -w '%{http_code}' \
    "${BASE_URL}/share/${public_key}/api/shared-links/me")"
  assert_status "200" "${status}" "resolve public asset id"
  extract_public_asset_id /tmp/sec-public-asset-source.json
  public_asset_id="${PUBLIC_ASSET_ID}"

  log "security: public extensioned thumbnail serves same bytes as legacy route"
  status="$(curl -sS \
    "${thumb_headers[@]}" \
    -H "Referer: ${BASE_URL}/s/${public_slug}" \
    -o /tmp/sec-public-thumb-legacy.bin \
    -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/assets/${public_asset_id}/thumbnail?size=preview")"
  assert_not_server_error "${status}" "public legacy thumbnail"
  assert_status "200" "${status}" "public legacy thumbnail"
  status="$(curl -sS \
    "${thumb_headers[@]}" \
    -H "Referer: ${BASE_URL}/s/${public_slug}" \
    -o /tmp/sec-public-thumb-ext.bin \
    -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/assets/${public_asset_id}/thumbnail.jpg?size=preview")"
  assert_not_server_error "${status}" "public extensioned thumbnail"
  assert_status "200" "${status}" "public extensioned thumbnail"
  cmp -s /tmp/sec-public-thumb-legacy.bin /tmp/sec-public-thumb-ext.bin \
    || die "public extensioned thumbnail bytes differ from legacy route"

  log "security: stale cookie on public slug thumbnail must not bypass via retry (not 200)"
  status="$(curl -sS \
    "${thumb_headers[@]}" \
    -H "Referer: ${BASE_URL}/s/${public_slug}" \
    -b "immich-share-password=${signed_stale}" \
    -o /tmp/sec-public-stale-thumb.bin \
    -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/assets/${public_asset_id}/thumbnail?size=preview")"
  assert_not_server_error "${status}" "public stale cookie thumbnail direct"
  if [[ "${status}" == "200" ]]; then
    die "public stale cookie thumbnail must not succeed without clearing cookie (media retry regression)"
  fi

  log "security: shared-links/me clears stale password cookie"
  rm -f /tmp/sec-public-stale.cookies
  status="$(curl -sS \
    -b "immich-share-password=${signed_stale}" \
    -c /tmp/sec-public-stale.cookies \
    -D /tmp/sec-public-stale-headers.txt \
    -o /tmp/sec-public-stale-share.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${public_slug}/api/shared-links/me")"
  assert_not_server_error "${status}" "public shared-links/me with stale cookie"
  assert_status "200" "${status}" "public shared-links/me with stale cookie"
  grep -qi 'immich-share-password' /tmp/sec-public-stale-headers.txt || die "expected Set-Cookie clearing stale password"
  grep -Eiq 'Max-Age=0|Expires=Thu, 01 Jan 1970' /tmp/sec-public-stale-headers.txt || die "expected stale password cookie deletion"

  # --- Protected unlock end-to-end (API + thumbnail) ---
  log "security: protected A unlock + thumbnail after correct password"
  rm -f /tmp/sec-protected-a.cookies
  unlock_share_to_jar "${protected_a_slug}" "${protected_a_password}" /tmp/sec-protected-a.cookies

  status="$(curl -sS \
    -b /tmp/sec-protected-a.cookies \
    -o /tmp/sec-protected-a-auth.json \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_a_slug}/api/shared-links/me")"
  assert_not_server_error "${status}" "protected A shared-links/me after unlock"
  assert_status "200" "${status}" "protected A shared-links/me after unlock"

  local unlocked_asset_id
  unlocked_asset_id="$(jq -r '.album.assets[0].id // .assets[0].id // empty' /tmp/sec-protected-a-auth.json)"
  [[ -n "${unlocked_asset_id}" ]] || die "protected A payload missing asset id after unlock"

  attempt=0
  while (( attempt < max_attempts )); do
    status="$(curl -sS \
      "${thumb_headers[@]}" \
      -H "Referer: ${BASE_URL}/s/${protected_a_slug}" \
      -b /tmp/sec-protected-a.cookies \
      -o /tmp/sec-protected-a-thumb.bin \
      -w '%{http_code}' \
      "${BASE_URL}/s/${protected_a_slug}/api/assets/${unlocked_asset_id}/thumbnail?size=preview")"
    assert_not_server_error "${status}" "protected A thumbnail after unlock (attempt ${attempt})"
    if [[ "${status}" == "200" ]]; then
      break
    fi
    attempt=$((attempt + 1))
    if (( attempt >= max_attempts )); then
      die "protected A thumbnail after unlock: expected HTTP 200, got ${status}"
    fi
    sleep 2
  done

  log "security: protected A extensioned thumbnail after unlock matches legacy"
  status="$(curl -sS \
    "${thumb_headers[@]}" \
    -H "Referer: ${BASE_URL}/s/${protected_a_slug}" \
    -b /tmp/sec-protected-a.cookies \
    -o /tmp/sec-protected-a-thumb-ext.bin \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_a_slug}/api/assets/${unlocked_asset_id}/thumbnail.jpg?size=preview")"
  assert_not_server_error "${status}" "protected A extensioned thumbnail after unlock"
  assert_status "200" "${status}" "protected A extensioned thumbnail after unlock"
  cmp -s /tmp/sec-protected-a-thumb.bin /tmp/sec-protected-a-thumb-ext.bin \
    || die "extensioned thumbnail bytes differ from legacy route"

  log "security: unsupported thumbnail extension is rejected"
  status="$(curl -sS \
    "${thumb_headers[@]}" \
    -H "Referer: ${BASE_URL}/s/${protected_a_slug}" \
    -b /tmp/sec-protected-a.cookies \
    -o /tmp/sec-protected-a-thumb-heic.bin \
    -w '%{http_code}' \
    "${BASE_URL}/s/${protected_a_slug}/api/assets/${unlocked_asset_id}/thumbnail.heic?size=preview")"
  assert_not_server_error "${status}" "thumbnail.heic rejection"
  assert_status "404" "${status}" "thumbnail.heic rejection"

  log "=== share security matrix OK ==="
}
