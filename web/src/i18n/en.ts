// English is the source-of-truth dictionary: its shape defines the Messages
// type every other locale must satisfy. Values are plain strings, or
// functions when a string depends on a count or other runtime value (this
// keeps pluralization and grammar under each language's own control).

export const en = {
  common: {
    today: 'Today',
    yesterday: 'Yesterday',
  },
  share: {
    documentTitleFallback: 'Shared Album',
    loading: 'Loading album…',
    unableToLoad: 'Unable to load',
    tryAgain: 'Try again',
    loadFailed: 'Failed to load shared link',
    emptyTitle: 'No items yet',
    emptyText: 'This album is empty',
  },
  password: {
    title: 'Password required',
    subtitle: 'This album is protected',
    label: 'Password',
    placeholder: 'Enter password',
    show: 'Show password',
    hide: 'Hide password',
    empty: 'Please enter a password',
    invalid: 'Invalid password',
    genericError: 'An error occurred. Please try again.',
    checking: 'Checking…',
    unlock: 'Unlock album',
  },
  topbar: {
    itemCount: (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`,
    select: 'Select',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    cancel: 'Cancel',
    download: 'Download',
    downloadAll: 'Download all',
    upload: 'Upload',
    uploadItems: 'Upload items',
    selected: (n: number) => `${n} selected`,
    downloadSelected: (n: number) => `Download (${n})`,
  },
  viewer: {
    close: 'Close',
    info: 'Info',
    download: 'Download',
    previous: 'Previous',
    next: 'Next',
  },
  exif: {
    camera: 'Camera',
    lens: 'Lens',
    settings: 'Settings',
    file: 'File',
    dimensions: 'Dimensions',
    time: 'Time',
    location: 'Location',
    description: 'Description',
    photo: 'Photo',
    video: 'Video',
    closeInfo: 'Close info',
  },
  upload: {
    title: 'Upload items',
    close: 'Close',
    dropHere: 'Drop files here',
    dragAndDrop: 'Drag and drop',
    photosAndVideos: 'Photos and videos',
    browse: 'Browse files',
    remove: 'Remove',
    failed: 'Upload failed',
    retrying: (attempt: number, total: number) => `Retrying (${attempt}/${total})…`,
    retryFailed: (n: number) => `Retry failed (${n})`,
    clearCompleted: (n: number) => `Clear completed (${n})`,
    preparing: 'Preparing…',
    checking: 'Checking…',
    waiting: 'Waiting…',
    duplicate: 'Already in album',
    tooLarge: 'Too large',
    offlinePaused: 'Offline — uploads paused, they will resume automatically',
    progressCount: (done: number, total: number) => `${done} of ${total}`,
    etaSeconds: (n: number) => `~${n} s left`,
    etaMinutes: (n: number) => `~${n} min left`,
    etaHours: (n: number) => `~${n} h left`,
    summaryUploaded: (n: number) => `${n} uploaded`,
    summaryDuplicates: (n: number) => `${n} already in album`,
    summaryFailed: (n: number) => `${n} failed`,
  },
  downloadProgress: {
    ready: 'Download ready',
    compressing: 'Compressing files',
    itemsZip: (n: number) => `${n} ${n === 1 ? 'item' : 'items'} · ZIP`,
    preparing: (done: number, total: number) => `Preparing ${done} / ${total}`,
    starting: 'Starting download…',
    done: 'Done',
  },
  selectAllFromDate: (label: string) => `Select all from ${label}`,
  home: {
    documentTitle: 'Immich Public Proxy — secure public sharing for your Immich albums',
    languageLabel: 'Language',
    nav: { quickStart: 'Quick start', github: 'GitHub' },
    hero: {
      eyebrow: 'Open source · MIT licensed',
      titleLead: 'Share your photos.',
      titleDim: 'Keep your server private.',
      sub: 'A secure, high-performance proxy that puts a modern web gallery in front of your shared Immich albums — and exposes nothing else. Your Immich instance stays safely out of reach.',
      viewGithub: 'View on GitHub',
      quickStart: 'Quick start',
      mockPreview: 'Preview of the public album gallery',
      mockDate: 'Today · Lisbon',
    },
    features: {
      eyebrow: 'Features',
      title: 'A viewing experience guests will recognise.',
      lead: 'Built to feel like Google Photos, served entirely through the proxy.',
      items: [
        {
          title: 'Justified gallery',
          body: 'Flickr-style rows that keep aspect ratio, grouped by date, with lazy-loaded thumbnails and video indicators.',
        },
        {
          title: 'Timeline scrubber',
          body: 'Quick navigation with year markers, touch-drag support, and a live date label that follows your position.',
        },
        {
          title: 'Selection & download',
          body: 'Multi-select, pick a whole day at once, then download a ZIP with live progress — when the link allows it.',
        },
        {
          title: 'Full-screen viewer',
          body: 'Full-resolution photos and video with swipe and keyboard navigation, plus an EXIF metadata panel.',
        },
        {
          title: 'Drag & drop upload',
          body: 'Guests contribute to albums with batch uploads, progress, and content-type checks — enabled per link in Immich.',
        },
        {
          title: 'Memorable URLs',
          body: 'Serve standard keys at /share/{key} or human-readable slugs at /s/{slug}.',
        },
      ],
    },
    security: {
      eyebrow: 'Secure by default · Quick start',
      title: 'Point it at Immich, set your URL, go.',
      lead: 'The proxy sits between the public internet and your server, so Immich is never exposed directly.',
      items: [
        {
          title: 'Layered request defences',
          body: 'Per-IP rate limiting, security headers (CSP, HSTS), strict input and UUID validation on every call.',
        },
        {
          title: 'Password-protected links',
          body: 'HMAC-SHA256 signed cookies keep protected albums sealed between visits.',
        },
        {
          title: 'CORS & hotlink protection',
          body: 'Explicit origin allowlist plus optional blocking of direct API access outside the web app.',
        },
      ],
      profilesLead: 'Start from a profile with sensible defaults:',
    },
    footer: {
      mitLicense: 'MIT license',
      legal: 'Open-source project · MIT licensed · Not affiliated with the Immich project.',
    },
  },
};

// The English dictionary's shape (with widened string/function types) is the
// contract every other locale must satisfy.
export type Messages = typeof en;
