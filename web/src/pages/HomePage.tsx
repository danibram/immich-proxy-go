import { For, onCleanup, onMount } from 'solid-js';
import { captureEvent, registerPage, unregisterPage } from '~/analytics';
import BrandMark from '~/components/BrandMark';
import { LOCALE_NAMES, locale, setLocale, SUPPORTED_LOCALES, t, type Locale } from '~/i18n';

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

// Feature/security copy is translated (see i18n dictionaries); the icons stay
// here and are paired with the translated items by index.
const FEATURE_ICONS = [
  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <rect x="3" y="4" width="7" height="7" rx="1.5" />
    <rect x="14" y="4" width="7" height="4" rx="1.5" />
    <rect x="14" y="11" width="7" height="9" rx="1.5" />
    <rect x="3" y="14" width="7" height="6" rx="1.5" />
  </svg>,
  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="9" cy="6" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="7" cy="18" r="1.6" fill="currentColor" stroke="none" />
  </svg>,
  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
    <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </svg>,
  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>,
  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path d="M12 16V4m0 0l-4 4m4-4l4 4" />
    <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </svg>,
  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path d="M9 15l6-6" />
    <path d="M11 6l1-1a4 4 0 016 6l-1 1" />
    <path d="M13 18l-1 1a4 4 0 01-6-6l1-1" />
  </svg>,
];

const SECURITY_ICONS = [
  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M12 2l8 4v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6z" />
  </svg>,
  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 018 0v3" />
  </svg>,
  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M10 21a2 2 0 004 0" />
  </svg>,
];

function LanguageSelect() {
  return (
    <label class="landing-lang">
      <span class="sr-only">{t().home.languageLabel}</span>
      <select
        aria-label={t().home.languageLabel}
        value={locale()}
        onChange={(e) => {
          const next = e.currentTarget.value as Locale;
          captureEvent('language_changed', { locale: next });
          setLocale(next);
        }}
      >
        <For each={SUPPORTED_LOCALES}>
          {(loc) => <option value={loc}>{LOCALE_NAMES[loc]}</option>}
        </For>
      </select>
    </label>
  );
}

export default function HomePage() {
  onMount(() => {
    registerPage('home');
    captureEvent('home_viewed');
  });

  onCleanup(() => {
    unregisterPage();
  });

  const home = () => t().home;

  return (
    <>
      <title>{home().documentTitle}</title>

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
              {home().nav.quickStart}
            </a>
            <LanguageSelect />
            <a class="landing-btn landing-btn--sm" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <GitHubIcon />
              {home().nav.github}
            </a>
          </div>
        </nav>
      </header>

      <section class="landing-hero" id="top">
        <div class="landing-wrap">
          <span class="landing-eyebrow">
            <span class="dot" />
            {home().hero.eyebrow}
          </span>
          <h1>
            {home().hero.titleLead} <span class="dim">{home().hero.titleDim}</span>
          </h1>
          <p class="sub">{home().hero.sub}</p>
          <div class="ctas">
            <a class="landing-btn" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <GitHubIcon />
              {home().hero.viewGithub}
            </a>
            <a class="landing-btn landing-btn--ghost" href="#start">
              {home().hero.quickStart}
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

          <div class="landing-mock" role="img" aria-label={home().hero.mockPreview}>
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
              <div class="landing-mock-date">{home().hero.mockDate}</div>
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
              {home().features.eyebrow}
            </span>
            <h2 class="landing-sec-title">{home().features.title}</h2>
            <p class="landing-sec-lead">{home().features.lead}</p>
          </div>
          <div class="landing-feat-grid">
            <For each={home().features.items}>
              {(feat, i) => (
                <article class="landing-feat">
                  {FEATURE_ICONS[i()]}
                  <h3>{feat.title}</h3>
                  <p>{feat.body}</p>
                </article>
              )}
            </For>
          </div>
        </div>
      </section>

      <section class="landing-section" id="start">
        <div class="landing-wrap">
          <div>
            <span class="landing-eyebrow">
              <span class="dot" />
              {home().security.eyebrow}
            </span>
            <h2 class="landing-sec-title">{home().security.title}</h2>
            <p class="landing-sec-lead">{home().security.lead}</p>
          </div>
          <div class="landing-dual">
            <div>
              <For each={home().security.items}>
                {(item, i) => (
                  <div class="landing-sec-item">
                    {SECURITY_ICONS[i()]}
                    <div>
                      <h4>{item.title}</h4>
                      <p>{item.body}</p>
                    </div>
                  </div>
                )}
              </For>
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
                {home().security.profilesLead}
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
                {home().nav.github}
              </a>
              <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
                {home().footer.mitLicense}
              </a>
            </div>
          </div>
          <div class="legal">{home().footer.legal}</div>
        </div>
      </footer>
    </>
  );
}
