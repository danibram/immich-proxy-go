# ADR-001: Custom Proxy Implementation in Go

## Status
Accepted

## Context
I wanted a secure way to share Immich albums publicly with specific requirements:

1. **Upload support** - Allow visitors to upload photos to shared albums (wedding photos, event galleries, etc.)
2. **Native Immich experience** - A web interface that feels like using Immich itself, not a stripped-down viewer
3. **Self-hosted friendly** - Easy deployment without complex dependencies
4. **Modern security** - Rate limiting, input validation, secure cookies, and proper CORS handling

Existing solutions like [alangrainger/immich-public-proxy](https://github.com/alangrainger/immich-public-proxy) served as reference for understanding the Immich API, but didn't meet all requirements (no upload support, different UI approach).

## Decision
Build a custom proxy from scratch with:

**Backend (Go)**
- **go-chi/chi** - Lightweight HTTP router
- **spf13/viper** - Configuration management
- **uber-go/zap** - Structured logging

**Frontend (SolidJS)**
- **SolidJS** - Reactive UI framework with excellent performance
- **Tailwind CSS** - Utility-first styling
- **Justified gallery** - Google Photos / Immich style photo layout

## Key Features
- Full upload support via shared links (when enabled in Immich)
- Justified photo gallery with proper aspect ratios
- Timeline scrubber for quick navigation
- Multi-select with batch download as ZIP
- Password-protected share support with signed cookies
- Slug/alias URL support (`/s/my-wedding` instead of random keys)

## Consequences

### Positive
- Single binary deployment
- Upload functionality that Immich shared links support
- UI that matches modern photo gallery expectations
- Full control over security implementation
- Support for custom URL slugs

### Negative
- More code to maintain than using existing solution
- Need to track Immich API changes
- Frontend and backend to keep in sync
