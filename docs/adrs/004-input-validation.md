# ADR-004: Input Validation Strategy

## Status
Accepted

## Context
User input must be validated to prevent injection attacks, path traversal, and other security issues.

## Decision
Implement strict input validation:

### UUID Validation
All asset IDs and album IDs must match canonical UUID text format:
```regex
^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$
```

Note: this validation checks UUID shape, not UUID version bits.

### Share Key Validation
Share keys must match:
```regex
^[a-zA-Z0-9_-]{1,100}$
```

### Thumbnail Size Validation
Only allowed values: `""` (empty), `"thumbnail"`, `"preview"`

### Upload Content-Type Validation
Only allow image and video MIME types:
```go
allowedUploadPrefixes = []string{
    "image/",
    "video/",
    "multipart/form-data",
}
```

## Consequences
### Positive
- Prevents SQL injection attempts in parameters
- Prevents path traversal attacks
- Blocks malicious file uploads
- Clear error messages for invalid input

### Negative
- May reject valid but unusual inputs
- Regex patterns need maintenance if Immich changes ID formats
