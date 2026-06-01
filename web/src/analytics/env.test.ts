import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_POSTHOG_HOST } from './constants';
import { isPostHogAllowed, readPostHogConfig } from './env';

function setMeta(name: string, content: string) {
  const meta = document.createElement('meta');
  meta.setAttribute('name', name);
  meta.setAttribute('content', content);
  document.head.appendChild(meta);
}

describe('analytics/env', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('reads PostHog config from proxy-injected meta tags', () => {
    setMeta('ipp-posthog-enabled', 'true');
    setMeta('ipp-posthog-api-key', 'phc_meta');
    setMeta('ipp-posthog-host', 'https://eu.i.posthog.com');
    setMeta('ipp-posthog-disable-session-recording', 'true');
    setMeta('ipp-posthog-autocapture', 'false');

    expect(readPostHogConfig()).toEqual({
      apiKey: 'phc_meta',
      host: 'https://eu.i.posthog.com',
      disableSessionRecording: true,
      autocapture: false,
    });
  });

  it('isPostHogAllowed requires enabled meta and api key', () => {
    setMeta('ipp-posthog-enabled', 'true');
    setMeta('ipp-posthog-api-key', '');
    expect(isPostHogAllowed()).toBe(false);

    document.head.innerHTML = '';
    setMeta('ipp-posthog-enabled', 'true');
    setMeta('ipp-posthog-api-key', 'phc_meta');
    expect(isPostHogAllowed()).toBe(true);

    document.head.innerHTML = '';
    setMeta('ipp-posthog-enabled', 'false');
    setMeta('ipp-posthog-api-key', 'phc_meta');
    expect(isPostHogAllowed()).toBe(false);
  });

  it('returns empty config when proxy meta tags are absent', () => {
    expect(readPostHogConfig()).toEqual({
      apiKey: '',
      host: DEFAULT_POSTHOG_HOST,
      disableSessionRecording: true,
      autocapture: false,
    });
    expect(isPostHogAllowed()).toBe(false);
  });
});
