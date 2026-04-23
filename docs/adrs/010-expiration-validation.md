# ADR-010: Share Link Expiration Validation

## Status
Accepted

## Context
Immich shared links can have an expiration date. While Immich validates this server-side, we add a double-check for defense in depth.

## Decision
Validate expiration client-side before processing requests:

```go
func (h *ShareHandler) validateSharedLink(link *immich.SharedLink) (string, int) {
    if link.ExpiresAt != nil && link.ExpiresAt.Before(time.Now()) {
        return "Shared link has expired", http.StatusGone
    }
    return "", 0
}
```

Returns HTTP 410 Gone for expired links.

Applied to:
- `GetSharedLink`
- `GetAlbum`
- `DownloadAssets` (bulk download)

## Consequences
### Positive
- Defense in depth (don't rely solely on Immich)
- Clear error message and status code (410 Gone)
- Reduces unnecessary requests to Immich for expired links

### Negative
- Slight time skew between proxy and Immich could cause inconsistencies
- Extra check adds minimal latency
