# ADR AI Context (Compact)

Use this file first when loading architecture context into AI tools.
It summarizes accepted ADRs and points to the primary implementation files.

## Quick Matrix

| ADR | Decision (short) | Main config knobs | Primary implementation |
|-----|-------------------|-------------------|------------------------|
| [001](001-go-rewrite.md) | Custom Go proxy + SolidJS frontend | N/A | `proxy/cmd/server/main.go`, `web/src/*` |
| [002](002-security-headers.md) | Security headers + optional hotlink checks | `security.enable_hsts`, `security.hotlink_protection` | `proxy/internal/middleware/security.go`, `proxy/internal/middleware/hotlink.go` |
| [003](003-rate-limiting.md) | In-memory per-IP rate limiting | `security.rate_limit`, `security.password_rate_limit`, `security.trust_proxy_headers` | `proxy/internal/middleware/ratelimit.go`, `proxy/cmd/server/main.go` |
| [004](004-input-validation.md) | Strict param/body shape validation | N/A | `proxy/internal/middleware/validate.go`, `proxy/internal/handlers/share.go` |
| [005](005-cors-configuration.md) | Explicit CORS allowlist/default deny | `security.allowed_origins`, `proxy.public_url` | `proxy/cmd/server/main.go` |
| [006](006-cookie-signing.md) | HMAC-signed share-password cookie | `security.cookie_secret`, `security.force_secure_cookies`, `security.trust_proxy_headers` | `proxy/internal/handlers/share.go`, `proxy/internal/middleware/sharekey.go` |
| [007](007-proxy-headers.md) | Upstream header allowlist + no-cache for share content | N/A | `proxy/internal/handlers/share.go`, `proxy/internal/handlers/static.go` |
| [008](008-idor-protection.md) | Trust Immich for share-scoped object authorization | N/A | `proxy/internal/handlers/share.go`, `proxy/internal/immich/client.go` |
| [009](009-bulk-download-zip.md) | Async ZIP jobs with progress | `options.allow_download`, `security.max_concurrent_download_jobs` | `proxy/internal/handlers/share.go`, `web/src/api/client.ts` |
| [010](010-expiration-validation.md) | Proxy-side expiration check (defense in depth) | N/A | `proxy/internal/handlers/share.go` |
| [011](011-trash-filtering.md) | Hide trashed assets from list/download flows | N/A | `proxy/internal/handlers/share.go` |
| [012](012-slug-url-support.md) | Support `/share/{key}` and `/s/{slug}` | N/A | `proxy/internal/middleware/sharekey.go`, `proxy/internal/immich/client.go`, `web/src/pages/SharePage.tsx` |

## Notes For AI Agents

- Prefer this file + `docs/specs/config.md` for fast onboarding.
- For security behavior, also read ADRs [002](002-security-headers.md), [003](003-rate-limiting.md), [006](006-cookie-signing.md), [008](008-idor-protection.md), [011](011-trash-filtering.md).
- For routing/share behavior, read ADRs [010](010-expiration-validation.md) and [012](012-slug-url-support.md).
