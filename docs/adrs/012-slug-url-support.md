# ADR-012: Slug URL Support

## Status
Accepted

## Context
Immich allows creating shared links with custom URL aliases (slugs) instead of random keys. For example:
- Standard key: `https://photos.example.com/share/JUckRMxlgpo7F9BpyqGk_cZEwDzaU...`
- Custom slug: `https://photos.example.com/s/my-wedding`

Custom slugs are useful for:
- Wedding galleries
- Event photo sharing
- Any case where a memorable URL is preferred

The Immich API handles keys and slugs differently:
- Keys: `GET /api/shared-links/me?key=AbCdEf...`
- Slugs: `GET /api/shared-links/me?slug=my-wedding`

## Decision
Support both URL formats with automatic detection:

| URL Pattern | API Query Parameter |
|-------------|---------------------|
| `/share/{value}` | `?key={value}` |
| `/s/{value}` | `?slug={value}` |

### Implementation

**Backend (Go)**
- `middleware.ExtractShareKey` detects URL prefix (`/s/` vs `/share/`)
- Stores `KeyType` in request context (`key` or `slug`)
- All handlers pass `keyType` to Immich client functions
- Immich client builds URLs with correct query parameter

**Frontend (SolidJS)**
- `api.setShareKey(key, type)` accepts share type
- `SharePage` detects URL path and passes correct type
- All API calls use the correct base URL (`/s/` or `/share/`)

## Consequences

### Positive
- Users can share memorable URLs like `/s/wedding-2024`
- Full compatibility with Immich's slug feature
- Backwards compatible - `/share/` still works with standard keys

### Negative
- Slightly more complex routing logic
- Both frontend and backend need to track key type
- Tests need to handle both query param formats

## API Reference
Based on [Immich API documentation](https://immich.app/docs/api/get-my-shared-link):
- `getMySharedLink` accepts `key`, `slug`, `token`, and `password` as query parameters
