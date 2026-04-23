# ADR-011: Trashed Asset Filtering

## Status
Accepted

## Context
Assets in Immich can be moved to trash. These shouldn't be visible in shared links.

## Decision
Filter trashed assets at multiple levels:

1. **List responses**: Filter `IsTrashed` assets from `GetSharedLink` and `GetAlbum` responses
```go
func (h *ShareHandler) filterValidAssets(assets []immich.Asset) []immich.Asset {
    valid := make([]immich.Asset, 0, len(assets))
    for _, asset := range assets {
        if !asset.IsTrashed {
            valid = append(valid, asset)
        }
    }
    return valid
}
```

2. **Individual asset requests**: Check `IsTrashed` in `GetAsset` and return 404
```go
if asset.IsTrashed {
    http.Error(w, "Asset not found", http.StatusNotFound)
    return
}
```

3. **Bulk download**: Skip trashed assets when building ZIP
```go
if asset.IsTrashed {
    continue
}
```

## Consequences
### Positive
- Consistent with Immich behavior
- Users don't see deleted content
- No information leakage about trashed assets

### Negative
- Requires checking each asset's status
- Immich may already filter these (redundant check)
