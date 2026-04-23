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

# Run tests with coverage
test-coverage:
    cd proxy && go test ./... -cover
    cd web && npm run test:coverage

# Watch frontend tests
test-watch:
    cd web && npm test

# === Development ===

# Start frontend dev server
dev-web:
    cd web && npm run dev

# Start backend dev server
dev-proxy:
    ./bin/immich-proxy --web-dir ./web/dist --config ./config.yaml 2>&1 | \
    jq -r '"\(.timestamp | split("T")[1] | split("+")[0]) [\(.level | ascii_upcase)] \(.msg)"'

# Start both frontend and backend (requires tmux or run in separate terminals)
dev: build
    @echo "Run 'just dev-web' and 'just dev-proxy' in separate terminals"

# Run the built proxy
run *ARGS:
    ./bin/immich-proxy --web-dir ./web/dist --config ./config.yaml {{ARGS}}

# === Docker ===

# Build Docker image
docker-build:
    docker build -t immich-public-proxy .

# Run Docker container
docker-run:
    docker run -p 3000:3000 --env-file .env immich-public-proxy

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
    @echo "  just dev-web    # Start frontend dev server"
    @echo "  just dev-proxy  # Start backend dev server"
    @echo ""
    @echo "Testing:"
    @echo "  just test       # Run all tests"
    @echo "  just test-watch # Watch mode"
