# ADR-008: IDOR Protection Strategy

## Status
Accepted (Revised)

## Context
IDOR (Insecure Direct Object Reference) attacks allow accessing resources by guessing/manipulating IDs. We need to ensure users can only access assets that belong to their shared link.

## Decision
### Initial Approach (Rejected)
Initially implemented client-side IDOR validation by checking if requested asset IDs exist in the shared link's asset list.

**Problem**: Immich's `/api/shared-links/me` endpoint doesn't return all assets for large albums, causing false negatives.

### Current Approach (Accepted)
**Trust Immich for IDOR validation**. Immich already validates that:
1. The share key is valid
2. The requested asset belongs to the shared link
3. The share hasn't expired

When we send `x-immich-share-key` header, Immich only returns assets from that share.

We still validate:
- UUID format (prevents injection)
- Share link expiration (double-check)
- Asset not trashed (filter from responses)

```go
// Note: We trust Immich to validate that this asset belongs to the shared link
// The share key header ensures Immich only returns assets from the share
resp, err := h.client.GetThumbnail(assetID, key, password, size)
```

## Consequences
### Positive
- Works with large albums
- Less latency (no extra API call to validate)
- Consistent with original immich-public-proxy behavior

### Negative
- Relies on Immich's security for IDOR protection
- Can't add additional access control beyond what Immich provides

## Security Note
This is acceptable because:
1. Immich is the source of truth for what's in a shared link
2. The share key header is validated server-side by Immich
3. We still validate input format to prevent injection
