#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-e2e/docker-compose.e2e.yml}"
PROXY_MODE="caddy"
KEEP_UP="false"
SKIP_BUILD="false"
WITH_PLAYWRIGHT="false"
PLAYWRIGHT_SECURITY_ONLY="false"
RUN_CONFIG_CASES="true"

usage() {
  cat <<'EOF'
Usage: e2e/run.sh [--proxy caddy|traefik|both] [--keep-up] [--skip-build] [--with-playwright] [--no-config-cases]

Options:
  --proxy      Which reverse proxy scenario to validate (default: caddy)
  --keep-up    Keep containers running after test completion
  --skip-build Skip docker image build
  --with-playwright Run Playwright security check against the reverse-proxied share URL
  --playwright-security-only Run only share security Playwright specs (no gallery suite)
  --no-config-cases Run only one scenario using current defaults (skip config matrix)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --proxy)
      PROXY_MODE="${2:-}"
      shift 2
      ;;
    --keep-up)
      KEEP_UP="true"
      shift
      ;;
    --skip-build)
      SKIP_BUILD="true"
      shift
      ;;
    --with-playwright)
      WITH_PLAYWRIGHT="true"
      shift
      ;;
    --playwright-security-only)
      WITH_PLAYWRIGHT="true"
      PLAYWRIGHT_SECURITY_ONLY="true"
      shift
      ;;
    --no-config-cases)
      RUN_CONFIG_CASES="false"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "${PROXY_MODE}" in
  caddy|traefik|both) ;;
  *)
    echo "Invalid --proxy value: ${PROXY_MODE}" >&2
    exit 1
    ;;
esac

compose=(docker compose -f "${COMPOSE_FILE}")

cleanup() {
  if [[ "${KEEP_UP}" != "true" ]]; then
    "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

declare -a profiles
declare -a test_targets
declare -a services=(redis database immich-server proxy)

if [[ "${PROXY_MODE}" == "caddy" || "${PROXY_MODE}" == "both" ]]; then
  profiles+=(--profile caddy)
  services+=(caddy)
  test_targets+=("caddy|http://caddy|http://localhost:8080")
fi

if [[ "${PROXY_MODE}" == "traefik" || "${PROXY_MODE}" == "both" ]]; then
  profiles+=(--profile traefik)
  services+=(traefik)
  test_targets+=("traefik|http://traefik|http://localhost:8081")
fi

run_scenario() {
  local scenario_name="$1"
  local allow_download="$2"
  local show_metadata="$3"
  local expected_download_status="$4"
  local expected_metadata_visible="$5"
  local run_playwright="$6"

  echo "[e2e] Cleaning previous stack state (${scenario_name})"
  IPP_OPTIONS_ALLOW_DOWNLOAD="${allow_download}" IPP_OPTIONS_SHOW_METADATA="${show_metadata}" \
    "${compose[@]}" "${profiles[@]}" down -v --remove-orphans >/dev/null 2>&1 || true

  echo "[e2e] Starting stack (${PROXY_MODE}) - scenario: ${scenario_name} (allow_download=${allow_download}, show_metadata=${show_metadata})"
  if [[ "${SKIP_BUILD}" == "true" ]]; then
    IPP_OPTIONS_ALLOW_DOWNLOAD="${allow_download}" IPP_OPTIONS_SHOW_METADATA="${show_metadata}" \
      "${compose[@]}" "${profiles[@]}" up -d "${services[@]}"
  else
    IPP_OPTIONS_ALLOW_DOWNLOAD="${allow_download}" IPP_OPTIONS_SHOW_METADATA="${show_metadata}" \
      "${compose[@]}" "${profiles[@]}" up -d --build "${services[@]}"
  fi

  echo "[e2e] Seeding Immich with shared albums (${scenario_name})"
  IPP_OPTIONS_ALLOW_DOWNLOAD="${allow_download}" IPP_OPTIONS_SHOW_METADATA="${show_metadata}" \
    "${compose[@]}" "${profiles[@]}" run --rm --no-deps seed

  if [[ ! -f "e2e/runtime/seed.env" ]]; then
    echo "[e2e][error] Missing e2e/runtime/seed.env after seed step" >&2
    exit 1
  fi

  # shellcheck disable=SC1091
  source e2e/runtime/seed.env

  for target in "${test_targets[@]}"; do
    IFS='|' read -r proxy_name base_url host_url <<<"${target}"
    echo "[e2e] Running assertions via ${proxy_name} (${base_url}) - ${scenario_name}"
    IPP_OPTIONS_ALLOW_DOWNLOAD="${allow_download}" IPP_OPTIONS_SHOW_METADATA="${show_metadata}" \
      "${compose[@]}" "${profiles[@]}" run --rm --no-deps \
      -e PROXY_NAME="${proxy_name}-${scenario_name}" \
      -e BASE_URL="${base_url}" \
      -e EXPECT_DOWNLOAD_STATUS="${expected_download_status}" \
      -e EXPECT_METADATA_VISIBLE="${expected_metadata_visible}" \
      tester

    if [[ "${WITH_PLAYWRIGHT}" == "true" ]]; then
      local -a playwright_specs=()
      if [[ "${PLAYWRIGHT_SECURITY_ONLY}" == "true" ]]; then
        playwright_specs=(
          e2e/public-share-security.spec.ts
          e2e/share-password-security.spec.ts
        )
        echo "[e2e] Running Playwright share-security specs via ${proxy_name} (${host_url}) - ${scenario_name}"
      elif [[ "${run_playwright}" == "true" ]]; then
        playwright_specs=(
          e2e/share-gallery.spec.ts
          e2e/share-proxy-options.spec.ts
          e2e/share-upload.spec.ts
          e2e/share-download.spec.ts
          e2e/share-asset-info.spec.ts
          e2e/share-i18n.spec.ts
          e2e/share-og.spec.ts
          e2e/public-share-security.spec.ts
          e2e/share-password-security.spec.ts
        )
        echo "[e2e] Running full Playwright UI suite via ${proxy_name} (${host_url}) - ${scenario_name}"
      else
        playwright_specs=(
          e2e/share-proxy-options.spec.ts
          e2e/share-password-security.spec.ts
        )
        echo "[e2e] Running Playwright proxy-options + password security via ${proxy_name} (${host_url}) - ${scenario_name}"
      fi
      (
        cd web
        set -a
        # shellcheck disable=SC1091
        source "${PWD}/../e2e/runtime/seed.env"
        export E2E_EXTERNAL_BASE_URL="${host_url}"
        export E2E_SCENARIO="${scenario_name}"
        set +a
        npx playwright test "${playwright_specs[@]}" --project=chromium --workers=1
      )
    fi
  done

  echo "[e2e] Scenario ${scenario_name} completed"
  echo "[e2e] Default share key: ${DEFAULT_SHARE_KEY}"
  echo "[e2e] Override-on share key: ${OVERRIDE_ON_SHARE_KEY:-n/a}"
  echo "[e2e] Override-off share key: ${OVERRIDE_OFF_SHARE_KEY:-n/a}"
}

if [[ "${RUN_CONFIG_CASES}" == "true" ]]; then
  run_scenario "downloads-on-metadata-on" "true" "true" "200" "true" "true"
  run_scenario "downloads-off-metadata-on" "false" "true" "403" "true" "false"
  run_scenario "downloads-on-metadata-off" "true" "false" "200" "false" "false"
else
  if [[ "${IPP_OPTIONS_ALLOW_DOWNLOAD:-true}" == "false" ]]; then
    run_scenario "default" "false" "${IPP_OPTIONS_SHOW_METADATA:-true}" "403" "${IPP_OPTIONS_SHOW_METADATA:-true}" "true"
  else
    run_scenario "default" "true" "${IPP_OPTIONS_SHOW_METADATA:-true}" "200" "${IPP_OPTIONS_SHOW_METADATA:-true}" "true"
  fi
fi

if [[ -f "e2e/runtime/seed.env" ]]; then
  # shellcheck disable=SC1091
  source e2e/runtime/seed.env
fi

# Downloads must survive hotlink protection (the app fetches blobs; it must not
# window.open() asset URLs, which send Sec-Fetch-Dest: document and get 403'd).
# Recreate the proxy with hotlink on and run the dedicated download spec.
if [[ "${WITH_PLAYWRIGHT}" == "true" && "${PLAYWRIGHT_SECURITY_ONLY}" != "true" ]]; then
  echo "[e2e] Recreating proxy with hotlink protection enabled"
  IPP_OPTIONS_ALLOW_DOWNLOAD="true" IPP_SECURITY_HOTLINK_PROTECTION="true" \
    "${compose[@]}" "${profiles[@]}" up -d --force-recreate proxy
  for target in "${test_targets[@]}"; do
    IFS='|' read -r proxy_name _ host_url <<<"${target}"
    echo "[e2e] Running Playwright hotlink download spec via ${proxy_name} (${host_url})"
    (
      cd web
      set -a
      # shellcheck disable=SC1091
      source "${PWD}/../e2e/runtime/seed.env"
      export E2E_EXTERNAL_BASE_URL="${host_url}"
      export E2E_HOTLINK_PROTECTION="true"
      set +a
      npx playwright test e2e/share-download-hotlink.spec.ts --project=chromium --workers=1
    )
  done
  # Restore the default (hotlink off) proxy so a --keep-up stack behaves normally.
  IPP_OPTIONS_ALLOW_DOWNLOAD="true" IPP_SECURITY_HOTLINK_PROTECTION="false" \
    "${compose[@]}" "${profiles[@]}" up -d --force-recreate proxy >/dev/null 2>&1 || true
fi

if [[ "${PROXY_MODE}" == "caddy" || "${PROXY_MODE}" == "both" ]]; then
  echo "[e2e] Caddy demo URL:   http://localhost:8080/share/${DEFAULT_SHARE_KEY}"
fi
if [[ "${PROXY_MODE}" == "traefik" || "${PROXY_MODE}" == "both" ]]; then
  echo "[e2e] Traefik demo URL: http://localhost:8081/share/${DEFAULT_SHARE_KEY}"
fi

if [[ "${KEEP_UP}" == "true" ]]; then
  echo "[e2e] Stack kept running. Stop it with:"
  echo "       docker compose -f ${COMPOSE_FILE} down -v --remove-orphans"
else
  echo "[e2e] Completed successfully"
fi
