# Immich Public Proxy - Task Runner
# Run `just` to see all available commands

set shell := ["bash", "-cu"]

# Default recipe - show help
default:
    @just --list

# === Build ===

# Build frontend and backend
build: build-web build-proxy

# Build frontend only
build-web:
    cd web && npm install && npm run build

# Build backend only
build-proxy:
    cd proxy && go build -o ../bin/immich-proxy ./cmd/server

# === Test ===

# Run all tests (backend + frontend)
test: test-backend test-frontend

# Run Go backend tests
test-backend:
    cd proxy && go test ./... -v

# Run Vitest frontend tests
test-frontend:
    cd web && npm test -- --run

# Run Playwright E2E tests
test-e2e: build-web
    cd web && npx playwright test

# Run docker-compose integration E2E (Immich + proxy + reverse proxy)
test-e2e-compose *ARGS:
    ./e2e/run.sh {{ARGS}}

# Shorthand: integration E2E with Playwright UI suite (single config case)
test-e2e-ui:
    ./e2e/run.sh --proxy caddy --with-playwright --no-config-cases

# Run tests with coverage
test-coverage:
    cd proxy && go test ./... -cover
    cd web && npm run test:coverage

# Watch frontend tests
test-watch:
    cd web && npm test

# === Development ===

# Start frontend dev server (hot reload — use http://localhost:5173)
dev-web:
    cd "{{ justfile_directory() }}/web" && npm run dev

# Start backend; rebuilds web once then serves web/dist on :3000 (no hot reload)
dev-proxy: build-proxy build-web
    IPP_OPTIONS_CACHE_TTL=0 "{{ justfile_directory() }}/bin/immich-proxy" --web-dir "{{ justfile_directory() }}/web/dist" --config "{{ justfile_directory() }}/config.yaml" 2>&1 | \
    jq -r '"\(.timestamp | split("T")[1] | split("+")[0]) [\(.level | ascii_upcase)] \(.msg)\(if .error then ": " + .error else "" end)"'

# Like dev-proxy but rebuilds web/dist automatically on file changes (refresh browser manually)
dev-proxy-watch: build-proxy build-web
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' EXIT INT TERM
    cd "{{ justfile_directory() }}/web"
    npm run build:watch &
    IPP_OPTIONS_CACHE_TTL=0 "{{ justfile_directory() }}/bin/immich-proxy" \
      --web-dir "{{ justfile_directory() }}/web/dist" \
      --config "{{ justfile_directory() }}/config.yaml" 2>&1 | \
    jq -r '"\(.timestamp | split("T")[1] | split("+")[0]) [\(.level | ascii_upcase)] \(.msg)\(if .error then ": " + .error else "" end)"'

# Build frontend once and serve it through the Go proxy
dev-proxy-static: build-proxy build-web
    IPP_OPTIONS_CACHE_TTL=0 "{{ justfile_directory() }}/bin/immich-proxy" --web-dir "{{ justfile_directory() }}/web/dist" --config "{{ justfile_directory() }}/config.yaml" 2>&1 | \
    jq -r '"\(.timestamp | split("T")[1] | split("+")[0]) [\(.level | ascii_upcase)] \(.msg)\(if .error then ": " + .error else "" end)"'

# Start both frontend and backend (requires tmux or run in separate terminals)
dev: build
    @echo "Frontend hot reload (recommended):"
    @echo "  Terminal 1: just dev-proxy"
    @echo "  Terminal 2: just dev-web"
    @echo "  Open http://localhost:5173/s/<slug>"
    @echo ""
    @echo "Single terminal on :3000 with auto-rebuild (manual browser refresh):"
    @echo "  just dev-proxy-watch"

# Run the built proxy
run *ARGS:
    "{{ justfile_directory() }}/bin/immich-proxy" --web-dir "{{ justfile_directory() }}/web/dist" --config "{{ justfile_directory() }}/config.yaml" {{ARGS}}

# === Docker ===

# Build Docker image
docker-build:
    docker build -t immich-proxy-go .

# Run Docker container
docker-run:
    docker run -p 3000:3000 --env-file .env immich-proxy-go

# Build and run Docker
docker: docker-build docker-run

# === Setup ===

# Install all dependencies
install:
    cd web && npm install
    cd proxy && go mod download

# Install Playwright browsers
install-playwright:
    cd web && npx playwright install

# === Cleanup ===

# Clean build artifacts
clean:
    rm -rf bin/
    rm -rf web/dist
    rm -rf web/node_modules

# Clean everything including caches
clean-all: clean
    rm -rf web/.vite
    rm -rf proxy/vendor
    go clean -cache

# === Lint ===

# Run linters
lint:
    -cd web && npm run lint
    -cd proxy && golangci-lint run ./...

# Format code
fmt:
    cd web && npx prettier --write "src/**/*.{ts,tsx,css}"
    cd proxy && go fmt ./...

# === Info ===

# Show project info
info:
    @echo "Immich Public Proxy"
    @echo "==================="
    @echo ""
    @echo "Frontend: SolidJS + Tailwind"
    @echo "Backend:  Go + Chi"
    @echo ""
    @echo "Quick start:"
    @echo "  just install    # Install dependencies"
    @echo "  just build      # Build everything"
    @echo "  just run        # Run the proxy"
    @echo ""
    @echo "Development:"
    @echo "  just dev-web         # Vite on :5173 (hot reload)"
    @echo "  just dev-proxy       # Go proxy on :3000 (static dist, rebuild on start)"
    @echo "  just dev-proxy-watch # :3000 + auto-rebuild dist on save"
    @echo ""
    @echo "Testing:"
    @echo "  just test       # Run all tests"
    @echo "  just test-watch # Watch mode"

# Preview the next release changelog without changing files
release-dry bump:
    ./scripts/release.sh {{bump}} --dry-run

# Bump version, update CHANGELOG, commit, and tag (then push main + tag)
release bump:
    ./scripts/release.sh {{bump}}

prod-build version:
	docker build \
	--platform linux/amd64 \
	-t rg.fr-par.scw.cloud/ddbr/immich-proxy-go:{{version}} \
	-f Dockerfile . \
	--no-cache \
	--progress=plain
	docker push rg.fr-par.scw.cloud/ddbr/immich-proxy-go:{{version}}
