/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_API_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_POSTHOG_DISABLE_SESSION_RECORDING?: string;
  readonly VITE_POSTHOG_AUTOCAPTURE?: string;
  /** Vite dev only: enable PostHog when the Go proxy is not serving index.html */
  readonly VITE_POSTHOG_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** Set by the proxy when serving index.html (from analytics.posthog.enabled) */
  __IPP_POSTHOG_ENABLED__?: boolean;
}
