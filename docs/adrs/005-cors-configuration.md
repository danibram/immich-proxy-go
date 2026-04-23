# ADR-005: CORS Configuration

## Status
Accepted

## Context
The original implementation used `AllowedOrigins: ["*"]` with `AllowCredentials: true`, which is insecure and browsers may reject it.

## Decision
Implement a tiered CORS configuration:

1. **Explicit origins** (most secure): If `security.allowed_origins` is set, use that list
2. **Public URL**: If `proxy.public_url` is set, use that as the single allowed origin
3. **Reject all** (default): If neither is configured, reject all cross-origin requests

```go
if len(cfg.Security.AllowedOrigins) > 0 {
    corsOptions.AllowedOrigins = cfg.Security.AllowedOrigins
} else if cfg.Proxy.PublicURL != "" {
    corsOptions.AllowedOrigins = []string{cfg.Proxy.PublicURL}
} else {
    // Reject all cross-origin requests
    corsOptions.AllowOriginFunc = func(r *http.Request, origin string) bool {
        return false
    }
}
```

A warning is logged if no CORS origins are configured.

## Consequences
### Positive
- No insecure wildcard CORS
- Clear configuration requirements for production
- Works correctly with reverse proxies

### Negative
- Requires explicit configuration in production
- May cause confusion during development if not configured
