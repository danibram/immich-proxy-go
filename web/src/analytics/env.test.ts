import { afterEach, describe, expect, it } from 'vitest';
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

  it('isPostHogAllowed is true only when meta enabled is true', () => {
    setMeta('ipp-posthog-enabled', 'false');
    expect(isPostHogAllowed()).toBe(false);

    document.head.innerHTML = '';
    setMeta('ipp-posthog-enabled', 'true');
    expect(isPostHogAllowed()).toBe(true);
  });

  it('returns empty config when proxy meta tags are absent', () => {
    expect(readPostHogConfig()).toEqual({
      apiKey: '',
      host: 'https://us.i.posthog.com',
      disableSessionRecording: true,
      autocapture: false,
    });
    expect(isPostHogAllowed()).toBe(false);
  });
});
