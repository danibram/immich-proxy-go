# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.2] - 2026-07-07

### Bug Fixes

- 🐛 Shield the viewport from hover hit-testing while scrubbing

Since the scrubber track stopped capturing pointer events (1.7.1), the
cursor hit-tests straight into the gallery during a drag. The gallery is
scrolling fast underneath, so the browser recomputes :hover every frame
and fades thumb-veils in/out on each tile streaming past the cursor —
visible jank that didn't happen when the wide track soaked up the events.

Mount a transparent full-viewport shield only while isDragging: it
absorbs hit-testing (no :hover churn), keeps cursor: grabbing, and
unmounts on release, so idle clicks on photos are still never
intercepted. Strictly better than pre-1.7.1, where horizontal drift
during a drag already hovered the gallery outside the 64px strip.


### Other

- Merge pull request #26 from danibram/codex/scrub-drag-shield

🐛 Shield the viewport from hover hit-testing while scrubbing

## [1.7.1] - 2026-07-07

### Bug Fixes

- 🐛 Restrict timeline scrubber hit area to the grip

The scrubber track was a full-height, 64px-wide strip fixed to the right
edge with pointer-events enabled — and invisible (opacity 0) while idle.
Clicks meant for photos near the right edge were captured by the
invisible track and jumped the gallery to another date.

Make the track a positioning rail only (pointer-events: none) and
re-enable events solely on the 48px grip pill (the visible handle with
the arrows), moving touch-action/cursor there. The bubble label is
explicitly non-interactive. Dragging is unaffected: once the grip
starts a drag, movement is tracked at document level, and the scrubber
still fades in on scroll.


### Other

- Merge pull request #25 from danibram/codex/scrubber-hit-area

🐛 Restrict timeline scrubber hit area to the grip

## [1.7.0] - 2026-07-07

### Features

- ✨ Extensioned thumbnail URLs for default Cloudflare edge caching

Cloudflare's DEFAULT cache eligibility is extension-based: webp/jpg/jpeg/
avif/png are cached (and origin Cache-Control is honoured), while
extensionless API paths are marked DYNAMIC and never cached — regardless
of the Cache-Control the proxy sends. Until now, edge-caching thumbnails
required a manual Cache Rule in the Cloudflare dashboard.

Add a canonical extensioned route alongside the legacy one:

  GET /api/assets/{assetID}/thumbnail.{ext}   (ext ∈ webp|jpg → else 404)

registered in both share route groups (/share/{key} and /s/{slug}),
outside the rate-limited group like the legacy route. The handler is a
pure alias of GetThumbnail: same authorization, same passthrough of
Immich's response including Content-Type — the extension is advisory
for CDNs, the header wins.

The viewer now builds thumbnail URLs as thumbnail.webp?size=thumbnail
and thumbnail.jpg?size=preview, mirroring Immich's per-size encoding.
The extension is never derived from the asset's original filename:
iPhone HEIC originals would produce .heic URLs, which Cloudflare's
default list excludes.

Invariants kept:
- Legacy extensionless /thumbnail keeps working (old cached HTML/JS).
- thumbnailCacheControl untouched: public shares → public,max-age;
  password-protected → private,max-age (or no-store); the extension
  changes cache *eligibility*, never the *directives*, so protected
  thumbnails stay out of shared caches.

Tests: Go handler tests pin byte/header parity with the legacy route,
auth enforcement and cache headers on the extensioned route, and
rejection of .heic/.png/etc. Compose e2e security matrix gains the
same checks against a real Immich. README's Cloudflare section now
documents that no Cache Rule is needed on default setups, keeps the
old instructions for pre-1.7 clients / non-default CDNs, and warns
against Edge-TTL overrides that ignore origin cache-control.


### Other

- Merge pull request #23 from danibram/codex/protected-browser-cache

✨ Browser-cache protected-share thumbnails (private) (v1.6.0)

- Merge pull request #24 from danibram/codex/thumbnail-extension-urls

✨ Extensioned thumbnail URLs for default Cloudflare edge caching

## [1.6.0] - 2026-07-07

### Features

- ✨ Browser-cache thumbnails of password-protected shares

Extends media caching to protected shares safely. New
options.protected_media_cache_ttl marks their thumbnails
Cache-Control: private, max-age=<ttl> — so only the authenticated visitor's
own browser caches them (speeding up re-scrolling within a session), while
shared caches (CDNs) must not store them and therefore can never serve them
to a visitor who lacks the password. Pragma/Expires are cleared so the
directive is honored. Defaults to 0 (off); public-share edge caching is
unchanged.


### Other

- Merge pull request #22 from danibram/codex/cdn-thumbnail-cache

✨ Edge-cache public thumbnails (Cloudflare-friendly) (v1.5.0)

## [1.5.0] - 2026-07-07

### Features

- ✨ Edge-cache public thumbnails via Cache-Control

Every gallery scroll re-fetches thumbnails from Immich; behind a CDN we can
serve them from the edge instead. New options.share_media_cache_ttl makes the
proxy advertise Cache-Control: public, max-age=<ttl> for thumbnails — but only
for PUBLIC shares (no password on the request). Password-protected shares
always stay no-store, so a CDN can never hand their images to a visitor who
never entered the password. Originals and video remain uncached (downloads,
not repeat views). Defaults to 0 (off) — no behavior change unless enabled.

README documents the Cloudflare Cache Rule (match the thumbnail paths, honor
the origin cache-control) that keeps protected thumbnails out of the edge.


### Other

- Merge pull request #21 from danibram/codex/link-previews-multiarch

✨ Link previews (OpenGraph) + noindex + multi-arch images (v1.4.0)

## [1.4.0] - 2026-07-07

### Features

- ✨ Unfurl shared links and keep them out of search engines

Two additions to the public surface of a shared link:

- OpenGraph / Twitter-card meta. The proxy injects per-share <head> tags
  (album name, description, cover image, canonical URL) into the SPA shell so
  a shared link previews properly in Slack, WhatsApp, iMessage, etc. The cover
  is served by a dedicated /{share}/og-cover endpoint kept OUTSIDE the
  hotlink-protected /api group, because unfurl bots send no Sec-Fetch headers.
  Security: meta is only emitted, and the cover only served, when the link
  loads without interactive input — a password-protected album's name and
  cover never leak from its bare URL (a bot carries no password cookie).

- X-Robots-Tag: noindex, nofollow on every /share and /s response. A "public"
  album is meant to be shared by URL, not indexed by Google. The header covers
  crawlers that never run the SPA's JS.

Covered by Go tests (public emits OG, protected leaks nothing, cover 200 vs
404) and share-og.spec.ts in the e2e suite.


### Other

- Merge pull request #20 from danibram/codex/i18n-locale-detection

✨ Localization: browser locale detection + homepage language selector (v1.3.0)

- 📦 Publish multi-arch (amd64 + arm64) images

Self-hosters commonly run on ARM (Raspberry Pi, ARM VPS, Apple Silicon) but
the release only built for the runner's arch. Build and push
linux/amd64,linux/arm64 via buildx + QEMU, and cross-compile the Go binary
on the build host (TARGETOS/TARGETARCH) instead of emulating the compile, so
the multi-arch build stays fast. The web build (static assets) is pinned to
the build platform for the same reason.

## [1.3.0] - 2026-07-06

### Features

- ✨ Localize the app and detect the browser language

Add a small i18n layer (English + Spanish) so the gallery UI adapts to the
visitor's browser locale, with a manual language selector on the homepage.

- i18n/: English is the source-of-truth dictionary; its shape types every
  other locale (so a missing/renamed key is a compile error). Count- and
  grammar-dependent strings are functions, keeping pluralization per language.
- Locale is a reactive signal: t() reads it, so switching re-renders. It
  resolves from an explicit stored choice, then navigator.language(s), then
  English; document.documentElement.lang follows.
- Wire every user-facing string (share states, password prompt, top bar,
  viewer, EXIF sheet, upload modal, download progress, date labels) through
  t(). Dates already used toLocaleDateString and stay locale-aware.
- Homepage: all marketing copy is translated and a persisted <select> lets
  visitors switch language on demand.


### Other

- Merge pull request #19 from danibram/codex/fix-download-hotlink

🐛 Fix downloads under hotlink protection (v1.2.1)


### Testing

- ✅ Cover i18n with unit and e2e tests

- i18n unit test: locale switching, per-language pluralization, persistence,
  and a shape-parity check that guards the translated feature/security arrays.
- share-i18n.spec.ts: a Spanish browser renders the share UI in Spanish, an
  English browser in English, and the homepage selector switches + persists.
- Pin the Playwright browser locale to en-US so specs asserting English UI
  text are deterministic; run the i18n spec in the full suite.

## [1.2.1] - 2026-07-06

### Bug Fixes

- 🐛 Fix downloads failing under hotlink protection

Selecting photos and downloading (single original or multi-asset ZIP) hit
"Direct access not allowed" on any share with hotlink protection enabled,
and navigated the tab to the raw asset / job URL.

The download flow used window.open() to fetch the asset and ZIP URLs. A
window.open navigation sends Sec-Fetch-Dest: document, which the hotlink
middleware rejects; only app-originated fetches (Sec-Fetch-Dest: empty) are
allowed. The single working case was the viewer button, which used an
<a download> element.

Download through fetch()+blob and save via a synthetic <a download> instead,
so every path (viewer button, single selection, multi-select ZIP) carries
Sec-Fetch-Dest: empty and works whether or not hotlink protection is on.
Filenames come from the response Content-Disposition, falling back to the
original filename / a default.

Coverage: this slipped through because the download e2e ran with hotlink
protection off and via Playwright's API context (no Sec-Fetch: document).
Add share-download-hotlink.spec.ts — asserts direct navigation is 403 and
that viewer/single/ZIP downloads still succeed — and a hotlink-on proxy pass
in run.sh so CI exercises it.


### Other

- Merge pull request #18 from danibram/codex/immich-v3-support

✨ Immich v3 support + media password hardening (v1.2.0)

## [1.2.0] - 2026-07-06

### Bug Fixes

- 🐛 Fix uploads through slug share routes

Apply share key or slug authentication atomically in both query parameters and headers. Add PNG, JPEG, and HEIC E2E coverage for long and short share URLs.


### Features

- ✨ Support Immich v3 shared-link API

Immich v3.0.1 changed several shared-link contracts that broke the proxy:

- Albums and shared links no longer include their assets inline
  (assetCount > 0, assets: []). Rebuild the list through the timeline API
  (timeline/buckets + timeline/bucket) and map the columnar payload back to
  Asset objects. Immich v2 responses pass through unchanged.
- Asset duration became numeric milliseconds (was "H:MM:SS" string), which
  500'd INDIVIDUAL shares on decode. A dedicated immich.Duration type
  accepts string, number, or null and always re-emits the classic string.
- Password-protected shares no longer authenticate via the `password` query
  param; clients must POST /shared-links/login and replay the
  immich_shared_link_token cookie. Fetch and cache that token per share;
  v2 (no login endpoint) keeps using the query param.
- EXIF and original filename dropped out of listings. Expose a sanitized
  GET /api/assets/{id} and have the viewer fetch details lazily, merging
  them into the store. The timeline `ratio` field feeds gallery aspect
  ratios so no fake EXIF is synthesized.

Also fixes the video viewer collapsing to 0x0 in the flex stage and derives
ZIP entry names from Content-Disposition when timeline assets carry no
originalFileName.


### Other

- Merge pull request #17 from danibram/codex/fix-slug-share-uploads

🐛 Fix uploads through slug share routes


### Security

- 🔒 Enforce share passwords on media endpoints under Immich v3

Immich v3 stopped enforcing shared-link passwords on the media endpoints:
/assets/{id}/thumbnail and /video/playback return 200 with just the share
key, even for password-protected links (while /shared-links/me correctly
401s). Because the proxy deliberately skips loading the link on those hot
paths for scroll performance, protected thumbnails and video were served
without a password.

Authorize those requests in the proxy with a 60s per-share verdict cache,
so a protected share still requires the password while galleries pay one
upstream lookup per share per minute instead of one per tile.

Also normalize per-asset errors: a foreign/unknown asset id now returns a
uniform 404 "Asset not found" across every asset endpoint (was 500 on the
info route, and the thumbnail route forwarded Immich's raw error body,
leaking upstream phrasing). Not-found and not-permitted stay
indistinguishable to prevent asset-id enumeration.


### Testing

- ✅ Add Immich v3 e2e coverage for downloads, asset info, and IDOR

- share-download.spec.ts: single + bulk ZIP downloads through /share and /s,
  API and real-browser UI (viewer button, single selection, multi-select),
  asserting exact PNG/JPEG/HEIC bytes; a self-written ZIP reader avoids a new
  dependency.
- share-asset-info.spec.ts: sanitized asset-details endpoint and the viewer's
  lazy EXIF sheet, plus INDIVIDUAL-share inline assets with normalized
  durations.
- public-share-security.spec.ts: a foreign asset id must not be reachable via
  a valid share key across every per-asset endpoint (no 200, no 500, no
  upstream body leak).
- Seed an INDIVIDUAL share; shell matrix now checks EXIF on the per-asset
  endpoint instead of the (now asset-less) listing.

## [1.1.7] - 2026-06-01

### Bug Fixes

- 🐛 Fix landing page mock blocked by Content-Security-Policy

Replace external picsum.photos placeholders with self-contained CSS
gradients so the homepage gallery preview works under strict img-src.

## [1.1.6] - 2026-06-01

### Added

- ✅ Share security e2e matrix for password-protected albums

Add a consolidated shell security matrix (public happy path, dual protected
albums A/B, cross-password isolation, stale-cookie regressions, no 5xx on
basic routes), Playwright security specs with isolated API contexts, and
`--playwright-security-only` for a fast local release gate.

## [1.1.5] - 2026-06-01

### Bug Fixes

- ⚡ Stop doubling Immich calls for thumbnails with stale password cookies

Remove media-level stale-password retry; clear obsolete cookies on
shared-links/me instead so each thumbnail is a single upstream request.
Add shell e2e coverage for the regression.

## [1.1.4] - 2026-06-01

### Bug Fixes

- ⚡ Restore gallery scroll performance after v1.1.3 regression

Stop calling loadShareLink on every thumbnail and video request. Each media
call still forwards slug/key and password to Immich for auth; only the redundant
upstream round-trip is removed.

## [1.1.3] - 2026-06-01

### Bug Fixes

- 🔒 Fix password-protected share bypass via stale cookies and media endpoints

Scope share-password cookies per slug/key, enforce auth before thumbnails and
video, and only drop stale passwords on Immich's explicit public-share 400.
Fix frontend 401 handling for plain-text invalid password responses.

### Tests

- ✅ Add shell and Playwright e2e coverage for password-protected shares

## [1.1.2] - 2026-06-01

### Bug Fixes

- 🐛 Ignore stale share-password cookies on public shares

Retry Immich share, album, and media requests without the password when
Immich reports that the shared link is not password protected.

## [1.1.1] - 2026-06-01

### Bug Fixes

- 🩹 Fix GitHub release notes to include only latest tag

- 🐛 Unify PostHog active state and widen CSP when analytics is on

Centralize Active(), Origins(), and CSPDirective() in config; inject
enabled meta only when active; align frontend gate and CSP allowlist
for PostHog cloud hosts without passing API keys into middleware.

- 🐛 Fix slug 404 handling and polish timeline scrubber

- 🩹 Stabilize thumbnail reloads and align timeline pill


### Features

- ✨ Improve thumbnail loading priority during fast scroll


### Other

- 🔧 Bump version to 1.1.0 in package-lock.json

## [1.1.0] - 2026-06-01

### Features

- ✨ Move PostHog config to runtime proxy injection


### Other

- 🔧 Append Docker image tags to GitHub release notes

Release workflow now adds pull command and tag table after git-cliff output.

## [1.0.0] - 2026-06-01

### Bug Fixes

- 🐛 Fix CSP-blocked PostHog flag and missing share assets

Use a CSP-safe meta tag for PostHog runtime config, serve favicon.svg, and fall back to thumbnail size when preview is unavailable.


### Documentation

- 📝 Align ADRs with implementation and add compact AI context

- update ADRs for rate limits, cookie secure behavior, UUID wording, and trash filtering
- document ZIP job concurrency cap in ADR-009
- add docs/adrs/AI_CONTEXT.md as single-file architecture summary
- align UUID validator code comment with actual regex behavior

- 📝 Document E2E flows and align default cache TTL in config

README covers Playwright/share-matrix testing; config defaults static cache TTL to zero for development.


### Features

- ✨ Add config profiles and E2E security matrix

- enforce metadata visibility as proxy.show_metadata && sharedLink.showMetadata
- add Docker Compose E2E stack (Immich + proxy + Caddy/Traefik) with seed/assert scripts
- add Playwright external-base-url support and public share security check
- document preset profiles and integration E2E workflow

- ✨ Add optional PostHog analytics with privacy-safe tracking

Integrate PostHog across the Go proxy and SolidJS UI with a runtime
toggle, build-time credentials, feature flags, and aggregated events
that avoid share keys or filenames. Serve the SolidJS home page at /
and align module/registry paths with danibram/immich-proxy-go.

- ✨ Honor cache TTL for static assets and disable cache when zero

Wire Options.CacheTTL through the server and assert no-store headers in tests.

- ✨ Redesign public share album UI and viewer

Replace Header/SelectionBar with ShareTopBar, add timeline scrubber, lazy thumbnails, EXIF sheet, carousel viewer, and refreshed landing page.

- ✨ Improve viewer UX, typography, and local dev workflow

Switch to bundled Geist/Bricolage fonts, fix carousel nav and video controls overlap, and rebuild dist on dev-proxy start so :3000 serves fresh frontend assets.


### Miscellaneous

- Initialize OSS repository


### Other

- 🔧 Add release automation with git-cliff and GHCR publishing

Introduce VERSION tracking, changelog generation, just release helpers,
and a tag-triggered workflow that creates GitHub Releases and pushes
Docker images to ghcr.io.

- 🧹 Ignore design-reference assets and local session files

Keep generated design mocks and OMC session state out of version control.

- 🎨 Add album design tokens, Instrument fonts, and style modules

Introduce design-tokens CSS, album layout styles, and self-hosted typography for the share experience.


### Refactor

- ♻️ Extract share password cookie signing into sharecookie package

Centralize HMAC sign/verify used by auth handlers and share-key middleware.

- ♻️ Wrap Immich transport failures as ErrUpstreamUnavailable

Let handlers detect upstream outages with errors.Is instead of string matching.

- ♻️ Split share handler into focused source files

Replace monolithic share.go with auth, read, media, upload, download, and support modules; add loadShareLink helpers and remove dead code.


### Testing

- ✅ Split share handler tests by concern

Share mocks, helpers, and read/media/auth tests live in separate files for easier navigation.

- ✅ Add table-driven tests for effective share options

Cover global vs per-link download and metadata flags.

- ✅ Expand E2E seed matrix and shared shell helpers

Table-driven Immich albums, canonical seed.env keys, lib.sh utilities, and justfile targets for proxy option cases.

- ✅ Add Playwright share gallery and proxy-options specs

API-driven capability checks, table-driven option matrix, and shared E2E helpers.

## [unreleased]

<!-- generated by git-cliff -->
