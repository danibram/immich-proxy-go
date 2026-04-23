# ADR-009: Bulk Download as ZIP

## Status
Accepted (Revised)

## Context
Users may want to download multiple assets at once. Downloading individually is tedious for large selections. The initial streaming implementation had issues with large albums (browser timeouts, no progress feedback).

## Decision
Implement a job-based bulk download system with progress tracking:

### Endpoints

**Start Job**: `POST /share/{key}/api/assets/download`
```json
// Request
{ "assetIds": ["uuid-1", "uuid-2", "uuid-3"] }

// Response
{ "jobId": "abc123..." }
```

**Check Progress**: `GET /share/{key}/api/download/jobs/{jobId}`
```json
{
  "id": "abc123...",
  "status": "processing", // processing | ready | failed
  "progress": 45,
  "total": 100,
  "filename": "album.zip"
}
```

**Download File**: `GET /share/{key}/api/download/jobs/{jobId}/file`

### Flow
1. Frontend requests download → receives job ID immediately
2. Frontend polls job status → shows progress bar
3. When status is "ready" → triggers download
4. Jobs auto-cleanup after 10 minutes

### Constraints
- Minimum 2 assets (otherwise use single download)
- All asset IDs must be valid UUIDs
- Downloads must be enabled at proxy AND shared link level
- Validates `allowDownload` on the Immich shared link
- Optional concurrency cap via `security.max_concurrent_download_jobs`
  (default `5`, `0` disables the cap)

### Features
- Progress tracking for large albums
- ZIP filename based on album name (sanitized)
- Handles duplicate filenames by appending counter
- Skips trashed assets
- Temporary file storage with automatic cleanup

### Access Control
Downloads are blocked if:
- Proxy config `options.allow_download: false`
- Shared link has `allowDownload: false` in Immich

## Consequences
### Positive
- Progress feedback for large downloads
- No browser timeout issues
- Retry capability if download fails
- Clear user feedback

### Negative
- Requires temporary disk storage
- Slightly more complex implementation
- Jobs need cleanup management
