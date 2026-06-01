#!/usr/bin/env bash
# Shared helpers for E2E shell scripts (seed, assert).

# effective_bool <global_true|false> <link_true|false> -> prints true|false
effective_bool() {
  if [[ "$1" == "true" && "$2" == "true" ]]; then
    printf 'true'
  else
    printf 'false'
  fi
}

# assert-proxy: global gates from scenario env
e2e_global_download_enabled() {
  [[ "${EXPECT_DOWNLOAD_STATUS:-200}" == "200" ]]
}

e2e_global_metadata_enabled() {
  [[ "${EXPECT_METADATA_VISIBLE:-true}" == "true" ]]
}

expected_download_status_for_link() {
  local link_allow_download="$1"
  if e2e_global_download_enabled && [[ "${link_allow_download}" == "true" ]]; then
    echo "200"
  else
    echo "403"
  fi
}

expected_metadata_visible_for_link() {
  local link_show_metadata="$1"
  if e2e_global_metadata_enabled && [[ "${link_show_metadata}" == "true" ]]; then
    echo "true"
  else
    echo "false"
  fi
}

# Build a JSON array of asset IDs for Immich API payloads.
asset_ids_json() {
  printf '%s\n' "$@" | jq -R . | jq -s .
}
