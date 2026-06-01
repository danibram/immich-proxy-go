import { onCleanup, onMount } from 'solid-js';
import { captureEvent, registerPage, unregisterPage } from '~/analytics';
import BrandMark from '~/components/BrandMark';

const GITHUB_URL = 'https://github.com/danibram/immich-proxy-go';

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.4 11.4 0 016 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

const FEATURES = [
  {
    title: 'Justified gallery',
    body: 'Flickr-style rows that keep aspect ratio, grouped by date, with lazy-loaded thumbnails and video indicators.',
    icon: (
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <rect x="3" y="4" width="7" height="7" rx="1.5" />
        <rect x="14" y="4" width="7" height="4" rx="1.5" />
        <rect x="14" y="11" width="7" height="9" rx="1.5" />
        <rect x="3" y="14" width="7" height="6" rx="1.5" />
      </svg>
    ),
  },
  {
    title: 'Timeline scrubber',
    body: 'Quick navigation with year markers, touch-drag support, and a live date label that follows your position.',
    icon: (
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="7" cy="18" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: 'Selection & download',
    body: 'Multi-select, pick a whole day at once, then download a ZIP with live progress — when the link allows it.',
    icon: (
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
        <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
    ),
  },
  {
    title: 'Full-screen viewer',
    body: 'Full-resolution photos and video with swipe and keyboard navigation, plus an EXIF metadata panel.',
    icon: (
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    title: 'Drag & drop upload',
    body: 'Guests contribute to albums with batch uploads, progress, and content-type checks — enabled per link in Immich.',
    icon: (
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M12 16V4m0 0l-4 4m4-4l4 4" />
        <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
    ),
  },
  {
    title: 'Memorable URLs',
    body: (
      <>
        Serve standard keys at <code>/share/&#123;key&#125;</code> or human-readable slugs at{' '}
        <code>/s/&#123;slug&#125;</code>.
      </>
    ),
    icon: (
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M9 15l6-6" />
        <path d="M11 6l1-1a4 4 0 016 6l-1 1" />
        <path d="M13 18l-1 1a4 4 0 01-6-6l1-1" />
      </svg>
    ),
  },
] as const;

const SECURITY_ITEMS = [
  {
    title: 'Layered request defences',
    body: 'Per-IP rate limiting, security headers (CSP, HSTS), strict input and UUID validation on every call.',
    icon: (
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 2l8 4v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6z" />
      </svg>
    ),
  },
  {
    title: 'Password-protected links',
    body: 'HMAC-SHA256 signed cookies keep protected albums sealed between visits.',
    icon: (
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 018 0v3" />
      </svg>
    ),
  },
  {
    title: 'CORS & hotlink protection',
    body: 'Explicit origin allowlist plus optional blocking of direct API access outside the web app.',
    icon: (
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M10 21a2 2 0 004 0" />
      </svg>
    ),
  },
] as const;

export default function HomePage() {
  onMount(() => {
    registerPage('home');
    captureEvent('home_viewed');
  });

  onCleanup(() => {
    unregisterPage();
  });

  return (
    <>
      <title>Immich Public Proxy — secure public sharing for your Immich albums</title>

      <header class="landing-nav">
        <nav class="landing-nav-inner">
          <a class="landing-brand" href="#top">
            <BrandMark />
            <span class="name">
              Immich Public <span class="muted">Proxy</span>
            </span>
          </a>
          <div class="landing-nav-right">
            <a class="txt" href="#start">
              Quick start
            </a>
            <a class="landing-btn landing-btn--sm" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <GitHubIcon />
              GitHub
            </a>
          </div>
        </nav>
      </header>

      <section class="landing-hero" id="top">
        <div class="landing-wrap">
          <span class="landing-eyebrow">
            <span class="dot" />
            Open source · MIT licensed
          </span>
          <h1>
            Share your photos. <span class="dim">Keep your server private.</span>
          </h1>
          <p class="sub">
            A secure, high-performance proxy that puts a modern web gallery in front of your shared Immich albums —
            and exposes nothing else. Your Immich instance stays safely out of reach.
          </p>
          <div class="ctas">
            <a class="landing-btn" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <GitHubIcon />
              View on GitHub
            </a>
            <a class="landing-btn landing-btn--ghost" href="#start">
              Quick start
            </a>
          </div>
          <div class="tech">
            <span>Go</span>
            <span class="tsep" />
            <span>SolidJS</span>
            <span class="tsep" />
            <span>Tailwind</span>
            <span class="tsep" />
            <span>Docker</span>
          </div>

          <div class="landing-mock" role="img" aria-label="Preview of the public album gallery">
            <div class="landing-mock-bar">
              <div class="dots">
                <i />
                <i />
                <i />
              </div>
              <div class="url">
                <LockIcon />
                photos.example.com/s/<span style={{ color: '#dcfce7' }}>summer-trip</span>
              </div>
            </div>
            <div class="landing-mock-body">
              <div class="landing-mock-scrub">
                <span class="thumb" />
              </div>
              <div class="landing-mock-date">Today · Lisbon</div>
              <div class="landing-mock-grid">
                <div class="ph ph-a" style={{ 'grid-column': 'span 4' }} />
                <div class="ph ph-b vid" style={{ 'grid-column': 'span 5' }} />
                <div class="ph ph-c" style={{ 'grid-column': 'span 3' }} />
                <div class="ph ph-d" style={{ 'grid-column': 'span 3' }} />
                <div class="ph ph-e" style={{ 'grid-column': 'span 4' }} />
                <div class="ph ph-f" style={{ 'grid-column': 'span 5' }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="landing-section landing-section--cream" id="features">
        <div class="landing-wrap">
          <div>
            <span class="landing-eyebrow">
              <span class="dot" />
              Features
            </span>
            <h2 class="landing-sec-title">A viewing experience guests will recognise.</h2>
            <p class="landing-sec-lead">Built to feel like Google Photos, served entirely through the proxy.</p>
          </div>
          <div class="landing-feat-grid">
            {FEATURES.map((feat) => (
              <article class="landing-feat">
                {feat.icon}
                <h3>{feat.title}</h3>
                <p>{feat.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section class="landing-section" id="start">
        <div class="landing-wrap">
          <div>
            <span class="landing-eyebrow">
              <span class="dot" />
              Secure by default · Quick start
            </span>
            <h2 class="landing-sec-title">Point it at Immich, set your URL, go.</h2>
            <p class="landing-sec-lead">
              The proxy sits between the public internet and your server, so Immich is never exposed directly.
            </p>
          </div>
          <div class="landing-dual">
            <div>
              {SECURITY_ITEMS.map((item) => (
                <div class="landing-sec-item">
                  {item.icon}
                  <div>
                    <h4>{item.title}</h4>
                    <p>{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div class="landing-code-card">
                <div class="landing-code-head">
                  <span class="fname">docker-compose.yml</span>
                  <span class="tag">Docker</span>
                </div>
                <pre>
                  <span class="k">services:</span>
                  {'\n'}
                  {'  '}
                  <span class="k">immich-public-proxy:</span>
                  {'\n'}
                  {'    '}
                  <span class="k">image:</span> <span class="s">ghcr.io/dbr/immich-public-proxy:latest</span>
                  {'\n'}
                  {'    '}
                  <span class="k">environment:</span>
                  {'\n'}
                  {'      '}- <span class="s">IMMICH_URL=http://immich-server:2283</span>
                  {'\n'}
                  {'      '}- <span class="s">PUBLIC_BASE_URL=https://photos.example.com</span>
                  {'\n'}
                  {'      '}- <span class="s">IPP_SECURITY_ALLOWED_ORIGINS=\</span>
                  {'\n'}
                  {'          '}
                  <span class="s">https://photos.example.com</span>
                  {'\n'}
                  {'    '}
                  <span class="k">ports:</span>
                  {'\n'}
                  {'      '}- <span class="s">"3000:3000"</span>
                </pre>
              </div>
              <p class="landing-run">
                Start from a profile with sensible defaults:
                <br />
                <span class="chip">read-only</span>
                <span class="chip">family-upload</span>
                <span class="chip">strict</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer class="landing-footer">
        <div class="landing-wrap">
          <div class="landing-footer-inner">
            <div class="name">
              <BrandMark size={24} />
              Immich Public Proxy
            </div>
            <div class="flinks">
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
              <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
                MIT license
              </a>
            </div>
          </div>
          <div class="legal">
            Open-source project · MIT licensed · Not affiliated with the Immich project.
          </div>
        </div>
      </footer>
    </>
  );
}
