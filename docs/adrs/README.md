# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the Immich Public Proxy project.

## AI Quick Start

For compact context loading, start with:

- [ADR AI Context (Compact)](AI_CONTEXT.md)

## What is an ADR?

An ADR is a document that captures an important architectural decision made along with its context and consequences.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-go-rewrite.md) | Custom Proxy Implementation | Accepted |
| [002](002-security-headers.md) | Security Headers and Request Validation | Accepted |
| [003](003-rate-limiting.md) | Rate Limiting Implementation | Accepted |
| [004](004-input-validation.md) | Input Validation Strategy | Accepted |
| [005](005-cors-configuration.md) | CORS Configuration | Accepted |
| [006](006-cookie-signing.md) | Signed Password Cookies | Accepted |
| [007](007-proxy-headers.md) | Proxy Response Header Handling | Accepted |
| [008](008-idor-protection.md) | IDOR Protection Strategy | Accepted (Revised) |
| [009](009-bulk-download-zip.md) | Bulk Download as ZIP | Accepted |
| [010](010-expiration-validation.md) | Share Link Expiration Validation | Accepted |
| [011](011-trash-filtering.md) | Trashed Asset Filtering | Accepted |
| [012](012-slug-url-support.md) | Slug URL Support | Accepted |

## Creating a New ADR

Use this template:

```markdown
# ADR-NNN: Title

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
What is the issue that we're seeing that is motivating this decision?

## Decision
What is the change that we're proposing and/or doing?

## Consequences
What becomes easier or more difficult to do because of this change?
```
