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

- **Full-screen viewer** - View photos and videos in full resolution
- **Swipe navigation** - Navigate between photos on mobile
- **Keyboard shortcuts** - Arrow keys and Escape on desktop
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
    image: ghcr.io/dbr/immich-public-proxy:latest
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

# E2E tests
cd web && npm run test:e2e

# Full integration E2E (Immich + proxy + Caddy/Traefik in Docker Compose)
just test-e2e-compose --proxy caddy
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

## Open Source

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

## License

[MIT](LICENSE)
