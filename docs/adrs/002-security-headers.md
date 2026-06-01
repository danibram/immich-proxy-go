# ADR-002: Security Headers and Request Validation

## Status
Accepted

## Context
Web applications need proper security headers to protect against common attacks like XSS, clickjacking, and MIME sniffing. Additionally, we want to prevent casual bypassing of the web interface via direct URL access.

## Decision

### Security Headers
Implement a `SecurityHeaders` middleware that adds the following headers to all responses:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'

When PostHog is active (`enabled` plus non-empty `api_key`), `script-src`, `connect-src`, and `img-src` allow the configured API host and its matching `*-assets.i.posthog.com` origin (cloud EU/US only; self-hosted uses the API host for both). `script-src` also includes `'unsafe-inline'`, which is required by `posthog-js` and weakens XSS defenses for the whole app while analytics is on.
```

Optional HSTS header when `security.enable_hsts` is true.

### Hotlink Protection (Optional)
When `security.hotlink_protection` is enabled, the `HotlinkProtection` middleware validates incoming requests using browser-provided `Sec-Fetch-*` headers:

**Allowed requests:**
- `Sec-Fetch-Dest: image/video/audio/empty` + `Sec-Fetch-Site: same-origin/same-site/cross-site`
- Requests with valid `Referer` header matching `public_url` (fallback for older browsers)

**Blocked requests:**
- `Sec-Fetch-Dest: document` (direct URL navigation)
- `Sec-Fetch-Site: none` (direct access, bookmarks)
- No headers (curl, wget, scripts)
- `Sec-Fetch-Dest: script/iframe` (embedding attempts)

This prevents:
- Sharing direct image/video URLs
- Hotlinking from external websites
- Using the API outside the web interface

**Note:** This is a deterrent, not a security guarantee. Headers can be spoofed by determined users.

## Consequences
### Positive
- Protection against clickjacking (X-Frame-Options, frame-ancestors)
- Protection against MIME sniffing attacks
- Reduced XSS attack surface via CSP
- Better privacy via Referrer-Policy
- Optional protection against direct URL access and hotlinking

### Negative
- `style-src 'unsafe-inline'` is required for Tailwind CSS
- May need CSP adjustments for specific deployments
- Hotlink protection may block legitimate old browsers without Sec-Fetch support
