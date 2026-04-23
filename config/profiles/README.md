# Config Profiles

Ready-to-use configuration presets:

- `read-only.yaml`: public viewing, downloads disabled, metadata hidden.
- `family-upload.yaml`: downloads enabled, intended for trusted/private sharing.
- `strict.yaml`: hardened public exposure (low limits, hotlink protection, HSTS).

## Quick Use

From repo root:

```bash
cp config/profiles/strict.yaml config.yaml
```

Then update at least:

1. `immich.url`
2. `proxy.public_url`
3. `security.allowed_origins`
4. `security.cookie_secret`

Generate a cookie secret:

```bash
openssl rand -hex 32
```

## Important

- Uploads are controlled by each shared link in Immich (`allowUpload`), not by a global proxy config flag.
- Downloads require both:
  - `options.allow_download: true` in proxy config
  - `allowDownload: true` on that shared link in Immich
- Metadata requires both:
  - `options.show_metadata: true` in proxy config
  - `showMetadata: true` on that shared link in Immich
