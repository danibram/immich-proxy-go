import { DEFAULT_POSTHOG_HOST } from './constants';

export interface PostHogConfig {
  apiKey: string;
  host: string;
  disableSessionRecording: boolean;
  autocapture: boolean;
}

function metaContent(name: string): string | undefined {
  const content = document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
  return content === null || content === undefined ? undefined : content;
}

function hasPostHogMetaTags(): boolean {
  return metaContent('ipp-posthog-enabled') !== undefined;
}

/** PostHog SDK options from proxy-injected meta tags (config.yaml). */
export function readPostHogConfig(): PostHogConfig {
  if (!hasPostHogMetaTags()) {
    return {
      apiKey: '',
      host: DEFAULT_POSTHOG_HOST,
      disableSessionRecording: true,
      autocapture: false,
    };
  }

  return {
    apiKey: metaContent('ipp-posthog-api-key')?.trim() ?? '',
    host: metaContent('ipp-posthog-host')?.trim() || DEFAULT_POSTHOG_HOST,
    disableSessionRecording: metaContent('ipp-posthog-disable-session-recording') !== 'false',
    autocapture: metaContent('ipp-posthog-autocapture') === 'true',
  };
}

/** True when the proxy injected active PostHog (enabled with api key). */
export function isPostHogAllowed(): boolean {
  if (metaContent('ipp-posthog-enabled') !== 'true') {
    return false;
  }
  return (metaContent('ipp-posthog-api-key')?.trim() ?? '') !== '';
}
