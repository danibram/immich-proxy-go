# Documentation

## Overview

This directory contains documentation for the Immich Public Proxy project.

## Structure

```
docs/
├── README.md           # This file
├── adrs/               # Architecture Decision Records
│   ├── README.md       # ADR index
│   └── 001-*.md        # Individual decisions
└── specs/              # Technical specifications
    ├── README.md       # Spec index
    ├── api.md          # API documentation
    ├── config.md       # Configuration reference
    └── deployment.md   # Deployment guide
```

## Quick Links

### For Operators
- [Configuration Reference](specs/config.md)
- [Deployment Guide](specs/deployment.md)

### For Developers
- [API Specification](specs/api.md)
- [Architecture Decisions](adrs/README.md)

## Security Documentation

Key security-related ADRs:
- [ADR-002: Security Headers](adrs/002-security-headers.md)
- [ADR-003: Rate Limiting](adrs/003-rate-limiting.md)
- [ADR-004: Input Validation](adrs/004-input-validation.md)
- [ADR-005: CORS Configuration](adrs/005-cors-configuration.md)
- [ADR-006: Cookie Signing](adrs/006-cookie-signing.md)
- [ADR-008: IDOR Protection](adrs/008-idor-protection.md)
