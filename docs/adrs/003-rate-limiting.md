# ADR-003: Rate Limiting Implementation

## Status
Accepted

## Context
The original immich-public-proxy had no rate limiting, making it vulnerable to:
- Brute force attacks on password-protected shares
- DoS attacks
- Resource exhaustion

## Decision
Implement in-memory rate limiting using a token bucket algorithm:

1. **General rate limit**: default 1000 requests/minute per IP (configurable via `security.rate_limit`)
2. **Password rate limit**: default 5 attempts/minute per IP (configurable via `security.password_rate_limit`)

The rate limiter:
- Uses `sync.RWMutex` for thread-safe access
- Uses `RemoteAddr` by default (safe mode)
- Trusts `X-Forwarded-For` / `X-Real-IP` only when `security.trust_proxy_headers=true`
- Automatically cleans up stale entries
- Returns `429 Too Many Requests` with `Retry-After` header when limit exceeded

## Consequences
### Positive
- Protection against brute force password attacks
- Protection against DoS
- Configurable limits for different deployment scenarios

### Negative
- In-memory storage means limits reset on restart
- Not suitable for horizontal scaling (would need Redis/similar)
- Misconfigured `trust_proxy_headers=true` can allow IP spoofing if upstream proxy is not trusted

## Future Considerations
For horizontal scaling, consider:
- Redis-based rate limiting
- Distributed rate limiting with sliding window
