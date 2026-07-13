# Immich Public Proxy

A secure, high-performance proxy server for sharing Immich albums publicly with a modern web interface.

## URL Formats

The proxy supports two URL formats:

| Format | Usage | Example |
|--------|-------|---------|
| `/share/{key}` | Standard Immich share keys | `/share/AbCdEf123...` |
| `/s/{slug}` | Custom URL aliases (slugs) | `/s/my-wedding` |

Custom slugs are configured in Immich when creating a shared link. They provide memorable, human-readable URLs.

## Features

### Justified Photo Gallery

- **Google Photos / Flickr style** - Images maintain aspect ratio with rows filling the full width
- **Responsive layout** - Adapts fluidly from mobile to ultra-wide displays
- **Date grouping** - Photos organized by date with smart labels
- **Lazy loading** - Thumbnails load on-demand for fast initial page load
- **Video support** - Play indicator and duration badge

### Timeline Scrubber

- **Immich-style scrubber** - Horizontal bar indicator for quick navigation
- **Year markers** - Jump between years
- **Touch support** - Drag to scroll through the timeline
- **Real-time feedback** - Date label follows your position

### Photo Selection

- **Multi-select mode** - Select individual photos with checkboxes
- **Visual feedback** - Selected photos shrink with ring highlight
- **Select by date** - One-click to select all photos from a day
- **Long press** - Enter selection mode on mobile
- **Bulk download** - Download selected photos as ZIP with progress tracking
- **Respects permissions** - Hidden when downloads are disabled

### Asset Viewer

- **Fullscreen viewer** - Native fullscreen mode for photos and videos
- **Real zoom** - Wheel, double-click, pinch and pan with a configurable quality cap
- **Swipe navigation** - Navigate between photos on mobile
- **Deep links & browser Back** - Link directly to a photo and return naturally to the gallery
- **Keyboard shortcuts** - Arrow keys, zoom, fullscreen and Escape on desktop
- **Automatic dark mode** - Follows the device color scheme
- **EXIF metadata** - Camera info, location, and file details
- **Info panel** - Slide-out panel on desktop, bottom sheet on mobile

### Upload Support

- **Drag & drop** - Upload photos to shared albums
- **Progress tracking** - Real-time upload progress
- **Batch upload** - Multiple files at once
- **Content-type validation** - Only allows images and videos

### Security

- **Rate limiting** - Configurable per-IP rate limits
- **Password protection** - Signed cookies for password-protected links
- **Security headers** - CSP, X-Frame-Options, HSTS, and more
- **Input validation** - UUID validation, share key validation
- **CORS configuration** - Explicit origin allowlist
- **Header filtering** - Whitelist approach for proxied headers
- **Hotlink protection** - Optional blocking of direct URL access (API must be called from web app)

## Quick Start

### Docker Compose

```yaml
version: '3.8'
services:
  immich-public-proxy:
    image: ghcr.io/danibram/immich-proxy-go:latest
    environment:
      - IMMICH_URL=http://immich-server:2283
      - PUBLIC_BASE_URL=https://photos.example.com
      - IPP_SECURITY_ALLOWED_ORIGINS=https://photos.example.com
    ports:
      - "3000:3000"
```

### Manual Build

```bash
# Build frontend
cd web && npm install && npm run build

# Build backend
cd proxy && go build -o ../bin/immich-proxy ./cmd/server

# Run
./bin/immich-proxy --web-dir ./web/dist --config ./config.yaml
```

## Configuration

Create a `config.yaml`:

```yaml
immich:
  url: "http://immich:2283"

proxy:
  port: 3000
  public_url: "https://photos.example.com"

options:
  allow_download: true
  max_download_quality: original # preview, fullsize, original
  max_zoom_quality: preview      # preview, fullsize
  show_metadata: true

security:
  rate_limit: 1000             # Requests per minute per IP
  password_rate_limit: 5       # Password attempts per minute
  max_upload_size: 100         # Max upload size in MB
  allowed_origins:             # CORS allowed origins
    - "https://photos.example.com"
  enable_hsts: false           # Enable HSTS header
  cookie_secret: ""            # Secret for signing cookies (auto-generated if empty)
  hotlink_protection: false    # Block direct URL access to API

# Optional PostHog (disabled by default — see docs/specs/config.md)
analytics:
  posthog:
    enabled: false
    api_key: ""
    host: "https://us.i.posthog.com"
    disable_session_recording: true
    autocapture: false
```

Predefined profiles are available in [config/profiles/README.md](config/profiles/README.md):

- `config/profiles/read-only.yaml`
- `config/profiles/family-upload.yaml`
- `config/profiles/strict.yaml`

Upload behavior note:
- Uploads are enabled/disabled per shared link in Immich (`allowUpload`), not by a global proxy toggle.
- Downloads are allowed only when both proxy config and shared link allow them.
- Metadata is shown only when both proxy config (`show_metadata`) and shared link (`showMetadata`) allow it.

### Environment Variables

```bash
IMMICH_URL=http://immich:2283
IPP_PORT=3000
PUBLIC_BASE_URL=https://photos.example.com
IPP_SECURITY_ALLOWED_ORIGINS=https://photos.example.com
IPP_SECURITY_RATE_LIMIT=100
IPP_COOKIE_SECRET=your-secret-here
```

PostHog is configured in `config.yaml` only (see `analytics.posthog` in the example above).

## Development

```bash
# Using just (recommended)
just dev

# Or manually:
cd web && npm run dev          # Frontend dev server
cd proxy && go run ./cmd/server --web-dir ../web/dist
```

## Testing

```bash
# All tests
just test

# Backend only
cd proxy && go test ./... -v

# Frontend only
cd web && npm test

# E2E smoke tests (Vite preview, no Immich)
cd web && npm run test:e2e

# Full integration E2E (Immich + proxy + Caddy/Traefik in Docker Compose)
just test-e2e-compose --proxy caddy

# Integration + Playwright (gallery, video, lazy load, proxy options)
just test-e2e-compose --proxy caddy --with-playwright

# Faster Playwright iteration (single config case)
just test-e2e-compose --proxy caddy --with-playwright --no-config-cases
```

See [E2E stack docs](e2e/README.md) for details and Traefik mode.

## Documentation

- [API Specification](docs/specs/api.md)
- [Configuration Reference](docs/specs/config.md)
- [Deployment Guide](docs/specs/deployment.md)
- [Immich API Reference](docs/specs/immich-api.md)
- [Design System](docs/design-system.md)
- [Architecture Decisions](docs/adrs/README.md)

## Tech Stack

**Backend (Go)**
- Chi router
- Zap structured logging
- Viper configuration

**Frontend (SolidJS)**
- SolidJS + TypeScript
- Tailwind CSS with glassmorphism design
- Custom pastel color palette
- Vite

## Security

This proxy implements multiple security layers:

| Feature | Description |
|---------|-------------|
| Rate Limiting | Token bucket per IP (configurable) |
| Security Headers | CSP, X-Frame-Options, HSTS, etc. |
| Input Validation | UUID format, share key format, thumbnail size |
| Signed Cookies | HMAC-SHA256 signed password cookies |
| CORS | Explicit origin allowlist |
| Header Filtering | Whitelist for proxied response headers |
| Upload Validation | Content-type validation (image/*, video/*) |
| Download Protection | Respects Immich `allowDownload` per shared link |
| Hotlink Protection | Block direct API access via Sec-Fetch headers |

See [ADRs](docs/adrs/) for detailed security design decisions.

## Deployment

### Behind Reverse Proxy (Recommended)

```
Internet → Caddy/Traefik/Nginx → immich-public-proxy → Immich
```

- Configure `allowed_origins` for your domain
- Set `cookie_secret` for persistent sessions
- Enable HSTS at proxy level or set `enable_hsts: true`

See [Deployment Guide](docs/specs/deployment.md) for full configuration examples.

### Edge caching thumbnails (CDN / Cloudflare)

Thumbnails are the highest-volume upstream traffic — every gallery scroll
re-fetches them from Immich. Set `options.share_media_cache_ttl` (seconds) to
let a CDN cache them at the edge:

```yaml
options:
  share_media_cache_ttl: 86400   # or env IPP_OPTIONS_SHARE_MEDIA_CACHE_TTL
```

The proxy then sends `Cache-Control: public, max-age=…` for thumbnails of
**public** shares only. Password-protected shares always stay `no-store`, so a
CDN can never serve their images to a visitor who lacks the password. Originals
and video remain uncached (they are downloads, not repeat views).

The web viewer requests thumbnails with an image extension in the path —
`…/thumbnail.webp?size=thumbnail` and `…/thumbnail.jpg?size=preview` — because
Cloudflare's **default** cache eligibility is extension-based (webp/jpg are on
the list; extensionless API paths are marked `DYNAMIC` and never cached). With
these URLs a default Cloudflare setup edge-caches public thumbnails out of the
box — **no Cache Rule needed**. For eligible paths Cloudflare honours the
origin `Cache-Control`, which is exactly what keeps password-protected
thumbnails out of the cache (`no-store`, or `private` — see below). The
extension is advisory only: it always reflects Immich's thumbnail encoding
(never the original filename — iPhone HEIC originals would not be on
Cloudflare's default list), and the response `Content-Type` header wins. The
share key is in the path, so cache entries never cross shares.

Only for **pre-1.7 clients** (old cached HTML/JS still requesting the legacy
extensionless `…/thumbnail` path, which keeps working) or CDNs with
**non-default** eligibility config do you still need a **Cache Rule**:

- **When**: URI Path matches `/share/*/api/assets/*/thumbnail` OR `/s/*/api/assets/*/thumbnail`
- **Then**: *Cache eligibility → Eligible for cache*, and *Edge TTL → Use cache-control header if present*

> **Warning**: never configure a global Edge TTL **override** that ignores the
> origin cache-control. It would make Cloudflare cache password-protected
> thumbnails (which the proxy marks `no-store`/`private`) and serve them to
> visitors who never entered the password. Always use *"Use cache-control
> header if present"*.

For **password-protected** shares, `options.protected_media_cache_ttl` lets the
authenticated visitor's *own browser* cache thumbnails without exposing them to
shared caches: the proxy sends `Cache-Control: private, max-age=…`, which
Cloudflare (a shared cache) will not store but the browser will. This speeds up
re-scrolling within a session at zero leak risk. It is off by default.

## Open Source

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

## License

[MIT](LICENSE)
