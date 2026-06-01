# E2E Stack (Immich + Proxy + Caddy/Traefik)

This E2E setup brings up:

- Immich (`immich-server` + `postgres` + `valkey`)
- `immich-public-proxy` (this repository image)
- Reverse proxy (`caddy` and/or `traefik`)
- Seed job that creates:
  - admin user
  - **24 JPEG images** (varied sizes/orientations, spread across dates) and **1 short MP4 video**
  - three public albums containing the full media set:
    - default-flags album (shared link created with Immich defaults)
    - override-on album (`allowDownload/allowUpload/showMetadata=true`)
    - override-off album (`allowDownload=false`, `allowUpload=false`)
  - plus one extra metadata-off link (`showMetadata=false`, `allowDownload=true`)
  - a private album (not reachable from public share routes)
  - a **password-protected** album/slug (`E2E_SHARE_PASSWORD`, default `e2e-secret-password`)
- Shell assertion job (HTTP contract + proxy option matrix)
- Optional **Playwright** browser tests (gallery, viewer, video, lazy loading, proxy/link UI gates)

## Prerequisites

- Docker + Docker Compose plugin
- For Playwright: `cd web && npx playwright install chromium` (or `just install-playwright`)

## Run

From repository root:

```bash
# API/contract checks only (config matrix)
./e2e/run.sh --proxy caddy

# Full stack + Playwright UI suite (recommended)
./e2e/run.sh --proxy caddy --with-playwright

# Fast iteration: single proxy config, full Playwright
./e2e/run.sh --proxy caddy --with-playwright --no-config-cases
```

Using `just`:

```bash
just test-e2e-compose --proxy caddy --with-playwright
just test-e2e-compose --proxy caddy --with-playwright --no-config-cases
```

Other modes:

```bash
./e2e/run.sh --proxy traefik --with-playwright
./e2e/run.sh --proxy both
./e2e/run.sh --proxy caddy --keep-up --with-playwright --no-config-cases
```

## Playwright Coverage

When `--with-playwright` is set:

| Spec | When it runs |
|------|----------------|
| `web/e2e/share-gallery.spec.ts` | Full UI: gallery load, slug route, lazy thumbnails, viewer navigation, video metadata |
| `web/e2e/share-proxy-options.spec.ts` | Download/upload/info visibility per share + global proxy flags |
| `web/e2e/public-share-security.spec.ts` | Private album isolation via browser |
| `web/e2e/share-password-security.spec.ts` | Password gate, cookie scope, stale-password regressions, thumbnail auth |

On the **config matrix**, the full gallery suite runs only for `downloads-on-metadata-on`. Other matrix scenarios run `share-proxy-options.spec.ts` only (faster, still validates global gates). Password security Playwright runs on every `--with-playwright` invocation.

Smoke tests in `web/e2e/share.spec.ts` run against Vite preview (`just test-e2e`) without Docker.

## Config Matrix

1. `downloads-on-metadata-on` — full shell + Playwright suite
2. `downloads-off-metadata-on` — shell checks + Playwright proxy-options only
3. `downloads-on-metadata-off` — shell checks + Playwright proxy-options only

## What Is Tested (Shell)

1. Reverse-proxied `/healthcheck` is reachable.
2. Share page (`/share/{key}`) loads HTML UI.
3. `GET /share/{key}/api/shared-links/me` works through the proxy.
4. Default shared-link flags from Immich are detected and validated through behavior.
5. Explicit overrides (download/upload/metadata).
6. Shared-link payload redaction.
7. Album endpoint and private album isolation.
8. Invalid share key returns `404`.
9. Password-protected slug: 401 without auth, unlock flow, scoped cookie, stale-password regressions, thumbnail auth.

## Using the Seeded Share

After a run, generated IDs are written to:

```bash
e2e/runtime/seed.env
```

Includes `DEFAULT_SHARE_KEY`, `DEFAULT_SHARE_SLUG`, `PASSWORD_PROTECTED_SHARE_SLUG`, `E2E_SHARE_PASSWORD`, `VIDEO_ASSET_ID`, `EXPECTED_ASSET_COUNT`, override keys, etc.

Demo URLs:

- `http://localhost:8080/share/<DEFAULT_SHARE_KEY>` (Caddy)
- `http://localhost:8081/share/<DEFAULT_SHARE_KEY>` (Traefik)
- `http://localhost:8080/s/<DEFAULT_SHARE_SLUG>` (slug route)

## Environment Variables (Seed)

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_IMAGE_COUNT` | `24` | Number of fake photos to generate/upload |
