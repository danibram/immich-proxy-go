# E2E Stack (Immich + Proxy + Caddy/Traefik)

This E2E setup brings up:

- Immich (`immich-server` + `postgres` + `valkey`)
- `immich-public-proxy` (this repository image)
- Reverse proxy (`caddy` and/or `traefik`)
- Seed job that creates:
  - admin user
  - one uploaded image
  - three albums containing that image:
    - default-flags album (shared link created with Immich defaults)
    - override-on album (`allowDownload/allowUpload/showMetadata=true`)
    - override-off album (`allowDownload=false`, `allowUpload=false`)
  - plus one extra metadata-off link (`showMetadata=false`, `allowDownload=true`) to validate metadata override behavior explicitly
- Assertion job with base end-to-end checks

## Prerequisites

- Docker + Docker Compose plugin

## Run

From repository root:

```bash
./e2e/run.sh --proxy caddy
```

By default this runs a config matrix:

1. `downloads-on-metadata-on` (`IPP_OPTIONS_ALLOW_DOWNLOAD=true`, `IPP_OPTIONS_SHOW_METADATA=true`)
2. `downloads-off-metadata-on` (`IPP_OPTIONS_ALLOW_DOWNLOAD=false`, `IPP_OPTIONS_SHOW_METADATA=true`)
3. `downloads-on-metadata-off` (`IPP_OPTIONS_ALLOW_DOWNLOAD=true`, `IPP_OPTIONS_SHOW_METADATA=false`)

Other modes:

```bash
./e2e/run.sh --proxy traefik
./e2e/run.sh --proxy both
```

Run with browser-level security check (Playwright):

```bash
./e2e/run.sh --proxy caddy --with-playwright
```

Run only one scenario (no config matrix):

```bash
./e2e/run.sh --proxy caddy --no-config-cases
```

Keep services running after test completion:

```bash
./e2e/run.sh --proxy caddy --keep-up
```

## What Is Tested

Base scenarios:

1. Reverse-proxied `/healthcheck` is reachable.
2. Share page (`/share/{key}`) loads HTML UI.
3. `GET /share/{key}/api/shared-links/me` works through the proxy.
4. Default shared-link flags from Immich are detected and validated through behavior:
   - download result follows `global allow_download && default allowDownload`
   - upload follows default `allowUpload`
   - metadata follows `global show_metadata && default showMetadata`
5. Explicit overrides are validated:
   - override-on share allows upload/download/metadata (subject to global gates)
   - override-off share blocks upload/download
   - dedicated metadata-off share blocks metadata exposure
6. Shared-link payload redaction (`userId`, `token`, `password`, album owner).
7. `GET /share/{key}/api/albums/{albumId}` works.
8. A private album ID is not reachable from a public share (`404`).
9. Invalid share key returns `404`.

## Using the Seeded Share

After a run, the generated IDs are written to:

```bash
e2e/runtime/seed.env
```

The runner also prints demo URLs, for example:

- `http://localhost:8080/share/<SHARE_KEY>` (Caddy)
- `http://localhost:8081/share/<SHARE_KEY>` (Traefik)
