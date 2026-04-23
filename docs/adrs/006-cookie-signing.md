# ADR-006: Signed Password Cookies

## Status
Accepted

## Context
Password-protected shares need to store the password client-side to avoid re-prompting. The original implementation stored the password in plain text in a cookie.

## Decision
Sign password cookies using HMAC-SHA256:

```go
// Format: base64(password) + "." + base64(hmac-sha256(password, secret))
signedValue := base64.URLEncoding.EncodeToString([]byte(password)) + "." +
               base64.URLEncoding.EncodeToString(signature)
```

Cookie attributes:
- `HttpOnly: true` - Prevents JavaScript access
- `SameSite: Strict` - Prevents CSRF
- `MaxAge: 86400` - 24 hour expiration

`Secure` cookie behavior is environment-aware:
- `Secure=true` when any of:
  - `security.force_secure_cookies=true`
  - `security.trust_proxy_headers=true` and `X-Forwarded-Proto=https`
  - direct TLS request (`r.TLS != nil`)
  - `proxy.public_url` starts with `https://`
- otherwise `Secure=false` (local HTTP/dev compatibility)

The signing secret:
- Can be configured via `security.cookie_secret`
- Auto-generated if not provided (warning logged)
- Should be set in production for cookie persistence across restarts

## Consequences
### Positive
- Tamper detection via HMAC signature
- Cookie cannot be modified by attackers
- Standard cookie security attributes

### Negative
- Password is still readable (base64 encoded, not encrypted)
- Auto-generated secret doesn't persist across restarts
- In local HTTP deployments, `Secure=false` may be required for compatibility

## Future Considerations
Consider using opaque session tokens instead of storing the password:
1. Validate password against Immich
2. Generate random session token
3. Store token -> share key mapping server-side
4. Cookie only contains session token
