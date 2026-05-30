#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${ROOT}/VERSION"
CHANGELOG="${ROOT}/CHANGELOG.md"

usage() {
  cat <<'EOF'
Usage: release.sh <patch|minor|major|X.Y.Z> [--dry-run]

Bumps VERSION, prepends the changelog for the new release, commits, and tags.

Examples:
  ./scripts/release.sh patch
  ./scripts/release.sh 1.2.0 --dry-run
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

BUMP="${1}"
DRY_RUN=false
if [[ "${2:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

if ! command -v git-cliff >/dev/null 2>&1; then
  echo "error: git-cliff is required (brew install git-cliff)" >&2
  exit 1
fi

if [[ "${DRY_RUN}" != true && -n "$(git -C "${ROOT}" status --porcelain)" ]]; then
  echo "error: working tree is not clean; commit or stash changes first" >&2
  exit 1
fi

current_version="$(tr -d '[:space:]' < "${VERSION_FILE}")"

bump_version() {
  local current="$1"
  local kind="$2"

  if [[ "${kind}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "${kind}"
    return
  fi

  IFS='.' read -r major minor patch <<< "${current}"
  case "${kind}" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    *)
      echo "error: invalid bump '${kind}' (use patch, minor, major, or X.Y.Z)" >&2
      exit 1
      ;;
  esac
}

new_version="$(bump_version "${current_version}" "${BUMP}")"
tag="v${new_version}"

if git -C "${ROOT}" rev-parse "${tag}" >/dev/null 2>&1; then
  echo "error: tag ${tag} already exists" >&2
  exit 1
fi

echo "Releasing ${current_version} -> ${new_version} (${tag})"
echo

preview="$(git -C "${ROOT}" cliff --config .git-cliff.toml --unreleased --tag "${tag}" --strip header)"
echo "Changelog preview:"
echo "${preview}"
echo

if [[ "${DRY_RUN}" == true ]]; then
  echo "dry-run: no files changed"
  exit 0
fi

git -C "${ROOT}" cliff --config .git-cliff.toml --unreleased --tag "${tag}" --prepend "${CHANGELOG}"
printf '%s\n' "${new_version}" > "${VERSION_FILE}"

if [[ -f "${ROOT}/web/package.json" ]]; then
  node -e "
    const fs = require('fs');
    const path = '${ROOT}/web/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = '${new_version}';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "
fi

git -C "${ROOT}" add VERSION CHANGELOG.md web/package.json
git -C "${ROOT}" commit -m "chore(release): ${tag}"
git -C "${ROOT}" tag -a "${tag}" -m "Release ${tag}"

cat <<EOF

Release prepared locally.

Next steps:
  git push origin main
  git push origin ${tag}

Pushing the tag triggers the GitHub release workflow (image + GitHub Release).
EOF
