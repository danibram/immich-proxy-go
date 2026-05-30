export interface PostHogBuildConfig {
  apiKey: string;
  host: string;
  disableSessionRecording: boolean;
  autocapture: boolean;
}

export function readPostHogBuildConfig(): PostHogBuildConfig {
  return {
    apiKey: import.meta.env.VITE_POSTHOG_API_KEY?.trim() ?? '',
    host: import.meta.env.VITE_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com',
    disableSessionRecording: import.meta.env.VITE_POSTHOG_DISABLE_SESSION_RECORDING !== 'false',
    autocapture: import.meta.env.VITE_POSTHOG_AUTOCAPTURE === 'true',
  };
}

/** Runtime gate from proxy config (injected in index.html) or Vite dev env. */
export function isPostHogAllowed(): boolean {
  if (typeof window.__IPP_POSTHOG_ENABLED__ === 'boolean') {
    return window.__IPP_POSTHOG_ENABLED__;
  }
  if (import.meta.env.DEV) {
    return import.meta.env.VITE_POSTHOG_ENABLED === 'true';
  }
  return false;
}
