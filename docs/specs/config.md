# Configuration Specification

Configuration can be provided via:
1. YAML config file (`config.yaml`)
2. Environment variables (prefixed with `IPP_`)
3. Command line flags

## Config File Example

```yaml
immich:
  url: "http://immich:2283"

proxy:
  port: 3000
  public_url: "https://photos.example.com"

options:
  allow_download: true
  show_metadata: true
  cache_ttl: 3600

security:
  rate_limit: 100
  password_rate_limit: 5
  max_upload_size: 100
  allowed_origins: ["https://photos.example.com"]
  enable_hsts: false
  cookie_secret: ""
```

## Configuration Options

### Immich

| Option | Type | Default | Env Var | Description |
|--------|------|---------|---------|-------------|
| `immich.url` | string | `http://localhost:2283` | `IMMICH_URL` | Internal URL to Immich server |

### Proxy

| Option | Type | Default | Env Var | Description |
|--------|------|---------|---------|-------------|
| `proxy.port` | int | `3000` | `IPP_PORT`, `PORT` | Port to listen on |
| `proxy.public_url` | string | `""` | `PUBLIC_BASE_URL`, `PUBLIC_URL` | Public URL for the proxy |

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `options.allow_download` | bool | `true` | Allow downloading original files (proxy-level) |
| `options.show_metadata` | bool | `true` | Show EXIF metadata in viewer |
| `options.cache_ttl` | int | `3600` | Cache TTL in seconds (currently unused) |

**Note**: Downloads are blocked if EITHER:
- `options.allow_download: false` in proxy config, OR
- `allowDownload: false` on the specific shared link in Immich

This allows administrators to globally disable downloads at the proxy level, while individual shares can also have downloads disabled via Immich settings.

**Note**: Metadata visibility is also restrictive:
- `EXIF/people data` is shown only if BOTH:
  - `options.show_metadata: true` in proxy config, AND
  - `showMetadata: true` on the specific shared link in Immich

This means proxy config can globally hide metadata, but cannot force metadata to be shown for a share where Immich has `showMetadata: false`.

**Note**: Upload permission is controlled by Immich shared-link settings (`allowUpload`).  
Proxy config does not include a global `allow_upload` switch; `security.max_upload_size` only caps upload size.

### Security

| Option | Type | Default | Env Var | Description |
|--------|------|---------|---------|-------------|
| `security.rate_limit` | int | `1000` | `IPP_SECURITY_RATE_LIMIT` | Requests per minute per IP |
| `security.password_rate_limit` | int | `5` | `IPP_SECURITY_PASSWORD_RATE_LIMIT` | Password attempts per minute per IP |
| `security.max_upload_size` | int | `100` | `IPP_SECURITY_MAX_UPLOAD_SIZE` | Max upload size in MB |
| `security.allowed_origins` | []string | `[]` | `IPP_SECURITY_ALLOWED_ORIGINS` | CORS allowed origins |
| `security.enable_hsts` | bool | `false` | `IPP_SECURITY_ENABLE_HSTS` | Enable HSTS header |
| `security.cookie_secret` | string | `""` | `IPP_COOKIE_SECRET`, `COOKIE_SECRET` | Secret for signing cookies |
| `security.hotlink_protection` | bool | `false` | `IPP_SECURITY_HOTLINK_PROTECTION` | Block direct API access (must come from web app) |
| `security.trust_proxy_headers` | bool | `false` | `IPP_SECURITY_TRUST_PROXY_HEADERS` | Trust X-Forwarded-* headers (only behind trusted reverse proxy) |
| `security.force_secure_cookies` | bool | `false` | `IPP_SECURITY_FORCE_SECURE_COOKIES` | Always mark auth cookies as `Secure` |
| `security.max_concurrent_download_jobs` | int | `5` | `IPP_SECURITY_MAX_CONCURRENT_DOWNLOAD_JOBS` | Max concurrent ZIP download jobs (`0` disables cap) |

## Environment Variables

All config options can be set via environment variables:

```bash
# Direct mapping
export IMMICH_URL="http://immich:2283"
export IPP_PORT="3000"
export PUBLIC_BASE_URL="https://photos.example.com"

# Nested config (replace . with _)
export IPP_SECURITY_RATE_LIMIT="100"
export IPP_SECURITY_ALLOWED_ORIGINS="https://example.com,https://www.example.com"
export IPP_COOKIE_SECRET="your-32-byte-hex-secret"
export IPP_SECURITY_TRUST_PROXY_HEADERS="true"
export IPP_SECURITY_FORCE_SECURE_COOKIES="true"
```

## Preset Profiles

Ready-to-use profile files live in:

- `config/profiles/read-only.yaml`
- `config/profiles/family-upload.yaml`
- `config/profiles/strict.yaml`

Guide: `config/profiles/README.md`

## Command Line Flags

```bash
./immich-proxy --config /path/to/config.yaml --web-dir /app/web/dist
```

| Flag | Description |
|------|-------------|
| `--config` | Path to config file |
| `--web-dir` | Path to web static files directory |

### Hotlink Protection Details

When `security.hotlink_protection: true`, the proxy validates that API requests come from the web interface using browser `Sec-Fetch-*` headers:

| Request Type | Headers | Result |
|--------------|---------|--------|
| `<img>` tag load | `Sec-Fetch-Dest: image`, `Sec-Fetch-Site: same-origin` | ✅ Allowed |
| `fetch()` API call | `Sec-Fetch-Dest: empty`, `Sec-Fetch-Site: same-origin` | ✅ Allowed |
| `<video>` tag load | `Sec-Fetch-Dest: video`, `Sec-Fetch-Site: same-origin` | ✅ Allowed |
| Direct URL in browser | `Sec-Fetch-Dest: document`, `Sec-Fetch-Site: none` | ❌ Blocked |
| curl/wget | No Sec-Fetch headers | ❌ Blocked |
| External site hotlink | `Sec-Fetch-Dest: image`, `Sec-Fetch-Site: cross-site` | ✅ Allowed* |

*Cross-site image loads are allowed because the browser correctly identifies them. To block external embedding, use CSP `frame-ancestors`.

**Note:** This is a deterrent against casual direct access, not a security guarantee. Headers can be spoofed.

## Production Recommendations

```yaml
security:
  # Always set allowed origins in production
  allowed_origins: ["https://your-domain.com"]

  # Generate with: openssl rand -hex 32
  cookie_secret: "your-64-char-hex-string"

  # Enable if always serving over HTTPS (or configure in reverse proxy)
  enable_hsts: true

  # Adjust based on your needs
  rate_limit: 1000
  password_rate_limit: 5
  max_upload_size: 100

  # Optional: block direct URL access to API
  hotlink_protection: false
```
