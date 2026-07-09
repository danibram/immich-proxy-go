# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.10.0] - 2026-07-09

### Bug Fixes

- 🐛 Add upload stall watchdog, retry with backoff, and retry-failed UI

A stalled TCP connection never fires load/error on its own, so one bad
upload froze the whole sequential queue forever (prod incident: family on
hotel wifi). The XHR now aborts after 30s without an upload.progress event
(plus a generous 10min absolute timeout as backstop) and transient failures
— network error, stall, 5xx, 429 — retry automatically with 1s/4s backoff.
Permanent 4xx (413/415) fail immediately; Immich's checksum dedupe makes
re-sends after ambiguous failures safe (verified in prod: 25 re-uploads
deduped at 0.24s each).

The modal shows retries honestly ("Retrying (2/3)…", i18n en+es), resets
the bar per attempt, keeps draining past permanently-failed files, and
offers a "Retry failed (n)" button for files that exhausted their retries.


### Documentation

- 📝 Document x-immich-checksum dedupe contract in the API spec


### Features

- ✨ Forward x-immich-checksum and add checksum-probe /upload-check endpoint

POST {share}/api/upload-check accepts {files:[{name,checksum}]} and answers
per-file {exists, assetId} without moving any file bytes: each checksum is
probed via a tiny POST /api/assets carrying x-immich-checksum and an
intentionally-invalid multipart (probe.xyz). Immich's AssetUploadInterceptor
short-circuits to 200 {status:duplicate} before consuming the body when the
checksum exists; otherwise the file filter rejects the probe with 400 before
creating anything (verified against Immich source at 2db1e02cdf; pinned by
e2e). Probes fan out with bounded concurrency (8), lists cap at 500, probe
failures fail open. Uploads now forward the client's x-immich-checksum so
Immich dedupes even mid-upload retries.

- ✨ Add hash-then-upload core: SHA-1 worker, adaptive pool, upload queue

- sha1.ts + hash.worker.ts: incremental SHA-1 over 5 MiB slices with
  @noble/hashes (same approach and library as Immich's own web client;
  crypto.subtle can't stream and is missing on plain-HTTP LAN installs).
- hasher.ts: lazy worker lifecycle with inline fallback and crash handling.
- pool.ts: adaptive concurrency policy — 3 parallel uploads, drops toward 1
  on consecutive stalls/retryable failures, recovers on successes; only one
  >50MB file in flight at a time.
- throughput.ts: EMA (α=0.1) throughput estimator + coarse ETA buckets.
- queue.ts: framework-agnostic state machine (pending → hashing → checking →
  queued → uploading → done|duplicate|failed|too-large) with pause/resume,
  offline-failure re-queueing, retry-failed, and batch dedupe-check wiring.
- client.ts: x-immich-checksum on uploads (every attempt), duplicate 200
  passthrough, POST /upload-check API.
- 60 unit tests across the new modules.


### Other

- 💄 Rewrite UploadModal as an optimistic tile-grid pipeline

Every selected file appears instantly as a preview tile (object URL,
revoked on removal/close — no leaks on 200-photo batches; HEIC that the
browser can't decode falls back to a placeholder via per-file feature
detection, not UA sniffing). Tiles advance pending → hashing → checking →
uploading (per-tile bar + retrying badge) → done | already-in-album |
failed | too-large, driven by the UploadQueue with the adaptive 3-wide
pool. Aggregate byte-weighted bar with 'N of M' and EMA-coarse ETA;
completion summary distinguishes uploaded / already in album / failed.
offline pauses the queue (in-flight rides, failures park instead of
failing), online resumes; beforeunload guards a non-empty queue. i18n
en+es for all new strings.

- Merge pull request #33 from danibram/codex/buttery-uploads

✨ Buttery uploads: optimistic tiles, hash-then-upload dedupe, adaptive pool


### Performance

- ⚡️ Skip redundant album-add on Immich v3 and log client aborts as info

Immich v3 auto-associates shared-link uploads with the album, so the
proxy's explicit album-add was one wasted round-trip plus a scary
'failed to add asset to album ... 403' warn per photo (the assets appeared
in the album seconds later). Detection reuses the shared-link login
machinery: /api/shared-links/login exists on v3+ only; the probe result is
cached server-wide. v2 keeps the explicit add. If the add is still
attempted and answers 403, that is the v3 auto-add — logged at debug, not
warn; genuine failures keep their warn.

Uploads whose client went away mid-stream (stall-watchdog abort, closed
tab, dropped wifi) now log 'upload aborted by client' at info instead of a
misleading upstream error, so the next incident is diagnosable from logs.


### Testing

- ✅ Add upload fault-injection e2e specs; fix corrupt PNG fixture and v3 drift

New share-upload-resilience.spec.ts drives the incident scenarios end to
end: a stalled first upload POST (route never fulfilled) must be aborted by
the watchdog, retried, completed, and the queue must proceed; a permanent
413 must fail after exactly one POST, not block the next file, and the
retry-failed button must re-attempt to completion. Watchdog/backoff shrink
via localStorage test hooks so a stall costs ~1.5s instead of 30s.

Two pre-existing suite breakages surfaced by immich-server:release drifting
to v3.0.1 (reproduced on main):
- assert-proxy.sh uploaded a 1x1 PNG with a corrupt IDAT (bad CRC);
  current Immich accepts the upload but AssetGenerateThumbnails fails with
  'vipspng: libpng read error', so the newest album asset never got a
  preview and the security matrix's public-thumbnail check 404'd forever.
  Replaced with a valid PNG (verified against Immich's own sharp/vips) and
  made the thumbnail assertion poll — preview generation is async.
- The stale-cookie-on-public-share thumbnail check pinned v2 behavior
  (upstream rejects a wrong password even on public shares). v3 ignores
  passwords on public shares entirely and 200s (verified directly against
  v3.0.1 with and without the password). The assertion now accepts both
  upstream generations and still forbids server errors; the follow-up
  assertion keeps pinning the cookie-cleanup path.

- ✅ Add upload-pipeline e2e specs: optimistic grid, zero-byte dedupe, offline, probe pin

- multi-file happy path asserts the optimistic tile grid before completion
- duplicate flow re-selects uploaded files and asserts 0 upload POSTs and
  0 bytes on the wire (network-event counting), tiles duplicate in seconds
- offline → pause (no failures marked) → online → auto-resume
- mixed PNG/JPEG/HEIC batch; HEIC placeholder via per-file feature detection
- upload-check probe contract pinned against the running Immich: unknown
  checksum creates nothing, known checksum returns the asset id, input caps
- wire the new spec into e2e/run.sh

- ✅ Measure dedupe savings via request.sizes(): Chromium hides multipart XHR bodies from postDataBuffer

- ✅ Measure upload bytes via the sent Content-Length header

Chromium exposes neither postDataBuffer nor sizes().requestBodySize for
multipart XHR bodies (verified with a standalone probe: both empty while
the wire carried 70,183 bytes); allHeaders()['content-length'] reports the
exact payload+framing size.

- ✅ Print dedupe-savings measurement to stdout for run evidence

## [1.9.0] - 2026-07-08

### Features

- ✨ Add pure timeline layout engine (justified rows, window math, anchoring)

computeTimelineLayout: date groups + asset ratios + container width ->
absolute row offsets and total height (greedy justified rows, ratio
clamps, per-group sections with headers). computeRowRange: binary search
of the visible row window. captureAnchor/restoreAnchor: keep the
top-visible asset stable across relayouts. Pure functions, unit tested.


### Other

- Merge pull request #30 from danibram/codex/virtual-window

♻️ Virtual window timeline: derive the gallery from scrollTop


### Performance

- ⚡️ Harden drag settle detection and cut per-frame reflow

- No scrollend listener: Chromium fires it after every programmatic
  scrollTop assignment, which ended the fast-scroll freeze between
  scrubber moves and loaded a window per intermediate position
  (497 requests per drag on the 520-asset album; 0 after this fix).
- Settle timer verifies on the next frame before unfreezing, so a
  main-thread stall with queued mousemove teleports can no longer
  burst-load mid-drag.
- boxTop (layout box offset in the scroll content) is cached and
  refreshed on measure/settle instead of forcing a reflow per scroll
  frame; rows get CSS containment so edge mounts stay local.


### Refactor

- ♻️ Derive the gallery from scrollTop: virtual window replaces per-tile lazy loading

The timeline now renders only the rows inside visible±1.5 viewports,
absolutely positioned inside a spacer of exact layout height. Mount =
load (img src set on mount), unmount = gone; image loads are deferred
while scrollTop teleports (scrubber drags) by freezing the load window
until scroll settles (scrollend or 150ms). Any transient glitch heals on
the next derivation pass because no per-tile load state accumulates.

Deleted: LazyThumbnail 5-state machine, viewportTracker sweep,
thumbnailLoader priority queue (+ their tests) and the scrubber's
hold() coupling. The scrubber now maps dates to exact layout offsets
instead of scanning the DOM.


### Testing

- ✅ Align gallery e2e assertions with the virtual window

- 'expected asset count' now asserts the meta count plus a bounded DOM
  (windowed gallery never mounts the whole album) and that the album end
  loads after scrolling there.
- lazy-load spec asserts request counts (window-sized on open, growing
  after scroll) instead of mounted-node counts.
- the concurrency-cap spec is replaced: with mount=load there is no
  client queue; the invariant is that a full-album teleport requests
  each thumbnail at most once and keeps the DOM window-sized.

- ✅ Add blank-tile stress spec + large-album seeder

5 cycles of aggressive scrubber drags (varying speeds and random
midpoints) then slow wheel through random sections on a ~520-asset
album; after every settle each visible tile must decode within 2s.
This is the regression class the derived window kills by construction.
Skips unless LARGE_SHARE_KEY is seeded (e2e/scripts/seed-large-album.sh).

## [1.8.0] - 2026-07-08

### Other

- 💄 Shorten OG fallback description to "Shared album"

- Merge pull request #27 from danibram/codex/scrub-load-gating

⚡️ Gate thumbnail loads on scroll settle while scrubbing

- Merge pull request #29 from danibram/codex/viewport-tracker

♻️ Extract gallery-level viewportTracker: one sweep owner instead of N observers


### Performance

- ⚡️ Gate thumbnail loads on scroll settle while scrubbing

Dragging the timeline scrubber through a 525-photo album teleports
scrollTop ~850px per mousemove; every LazyThumbnail passing through the
preload zone enqueued a load, mounted an <img> and fetched — ~506
thumbnail requests in one drag, dropping it to ~140ms/frame (~7fps).
The fetch/decode/raster storm was the cost: main-thread JS stayed ~90ms
for the whole drag.

Three coordinated changes, all at loader altitude:

- ThumbnailLoader.hold(settleMs): the scrubber renews a 150ms hold on
  every drag scroll write, so nothing starts mid-drag but the queue
  drains ~150ms after the grip stops — even mid-drag with the button
  still down. Wheel scrolling is untouched (only the scrubber holds).
- In-flight cancellation: LazyThumbnail now cancels 'loading' items
  that leave the 2.5-viewport cancel zone (previously only 'queued'
  ones), clearing img.src so the browser aborts the fetch and the
  loader slot frees for the visible viewport.
- Deferred, coalesced pump: starting the next job synchronously from a
  cancel let a scroll-jump sweep start stale queued jobs (pre-jump
  priorities) that the very next component's check aborted — a burst of
  ~11 doomed requests per teleport. One pump deferred to a fresh task
  runs after the whole sweep.

Measured on the e2e stack (525 assets, cold page, 60-move ~5s drag,
shield on, 2 runs):

                        before          after
  thumb reqs in drag    506             0-4
  avg frame during drag 138-150ms       55-60ms
  p95 frame             192-217ms       83ms
  frames >33ms          95-100%         71-79%
  first load after drop n/a (all sent)  91-97ms
  viewport filled after 0 (pre-loaded)  ~170ms

Holding the grip still mid-drag starts visible loads within ~100ms.
Gentle wheel scrolling is unchanged: same 514 requests, zero blank
visible tiles in both builds, frame stats within noise.

The fast-scroll concurrency e2e spec now counts live requests via
network events (request/requestfinished/requestfailed) instead of
inside the delayed route callback, which kept aborted requests
"active" until their artificial delay unwound.


### Refactor

- ♻️ Unify loader deferral, make cancel always reject, single reset path

Three internal simplifications, no behavior change intended:

- ThumbnailLoader: replace the two timer mechanisms (hold's settle
  timer + schedulePump's coalescing macrotask) with one deadline-based
  deferPump(). Deletes held/holdTimer/pumpScheduled and the !held check
  in pump(). An enqueue or release during a settle window can never
  shorten it: earlier-or-equal deadlines are already covered by the
  pending timer.

- ThumbnailLoader: cancel() now always rejects with AbortError. Task
  promises resolve only on release() (starts are signalled via onStart,
  which nothing awaited on the promise anyway), so cancelling a started
  job frees its slot and rejects instead of resolving silently. Deletes
  the started-branch in cancelJob that routed through releaseJob. The
  only consumer bumps its requestId before every cancel, so the
  rejections stay swallowed.

- LazyThumbnail: collapse the duplicated reset paths (asset change,
  cancel-zone exit) into abortToIdle(), and replace the status-based
  guards in handleImgLoad/handleImgError with the equivalent
  currentTask null check (non-null exactly while queued/loading,
  nulled on every cancel path).

Also un-exports SCROLL_SETTLE_MS (no external users) and fixes a
garbled comment in share-gallery.spec.ts.

- ♻️ Extract gallery-level viewportTracker to own the position sweep

Each LazyThumbnail owned an IntersectionObserver, a container scroll
listener, a window resize listener and an rAF-coalesced check — N photos
meant N of each, and the position-evaluation sweep was emergent rather
than owned. viewportTracker now owns it: ONE scroll listener, ONE
rAF-coalesced sweep and ONE IntersectionObserver per scroll root, running
opaque evaluate callbacks and ending each sweep with a loader pump.

Deleted from LazyThumbnail (~50 lines): the per-instance observer,
scroll/resize listeners, frameId/scheduleNearCheck plumbing and their
cleanup. Kept: the load-lifecycle state machine, the no-IO fallback
(load unconditionally) and effect re-registration when the
scrollContainer accessor changes.

Kept deliberately: the loader's deferred single-timer pump (now the
public pump(), the tracker's sweep-end entry) because it is the one
mechanism that both coalesces mid-sweep cancels and gates starts behind
a pending hold() deadline; and the scrubber's explicit hold() call,
because scrollTop-delta teleport detection cannot distinguish a scrub
teleport (~880px/frame, must gate) from a fast wheel fling
(~600px/frame, must keep loading).


### Testing

- ✅ Handle cancelled-task rejection synchronously in sweep test

stale.cancel() rejects its promise at cancel time; the rejects
expectation was attached only after an await, so vitest flagged an
unhandled rejection and failed the CI run despite 127/127 passing.
Attach the handler in the same synchronous block, and assert the
already-started job resolves (cancelling an active job releases its
slot rather than rejecting).

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
