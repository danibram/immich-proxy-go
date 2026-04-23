# ADR-007: Proxy Response Header Handling

## Status
Accepted

## Context
When proxying responses from Immich, we need to:
1. Avoid leaking sensitive information
2. Remove hop-by-hop headers that shouldn't be forwarded
3. Set appropriate cache headers

## Decision
Use an **allowlist** approach instead of blocklist:

```go
allowedHeaders := map[string]bool{
    "Content-Type":        true,
    "Content-Length":      true,
    "Content-Disposition": true,
    "Content-Encoding":    true,
    "Content-Range":       true,
    "Accept-Ranges":       true,
    "Last-Modified":       true,
    "Etag":                true,
}
```

This automatically excludes:
- Hop-by-hop headers: `Connection`, `Transfer-Encoding`, `Upgrade`, etc.
- Sensitive headers: `Set-Cookie`, `Server`, `X-Powered-By`
- Internal headers: `X-Immich-Api-Version`

## Cache Policy
Share content uses strict no-cache:
```
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
```

Static frontend assets use appropriate caching:
- `/assets/*.js`, `/assets/*.css` (hashed): `max-age=31536000, immutable`
- `index.html`: `no-cache, must-revalidate`
- Images/favicon: `max-age=86400`

## Consequences
### Positive
- No accidental header leakage
- No hop-by-hop header issues
- Clear cache policy prevents private content caching

### Negative
- May need to add headers to allowlist if Immich adds new useful headers
- Strict no-cache may impact performance for repeat views
