import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShareRouteTypeFromPath } from './routes';

const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  onFeatureFlags: vi.fn((cb: () => void) => cb()),
  isFeatureEnabled: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: posthogMock,
}));

function setPostHogMetaTags(opts: {
  enabled: string;
  apiKey?: string;
  host?: string;
  disableSessionRecording?: string;
  autocapture?: string;
}) {
  document.head.innerHTML = '';
  const tags: Array<[string, string]> = [
    ['ipp-posthog-enabled', opts.enabled],
    ['ipp-posthog-api-key', opts.apiKey ?? ''],
    ['ipp-posthog-host', opts.host ?? 'https://us.i.posthog.com'],
    [
      'ipp-posthog-disable-session-recording',
      opts.disableSessionRecording ?? 'true',
    ],
    ['ipp-posthog-autocapture', opts.autocapture ?? 'false'],
  ];
  for (const [name, content] of tags) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', name);
    meta.setAttribute('content', content);
    document.head.appendChild(meta);
  }
}

async function loadPosthogModule() {
  vi.resetModules();
  return import('./posthog');
}

describe('analytics/routes', () => {
  it('detects slug vs share route type', () => {
    expect(getShareRouteTypeFromPath('/s/wedding')).toBe('slug');
    expect(getShareRouteTypeFromPath('/share/abc123')).toBe('share');
  });
});

describe('analytics/posthog', () => {
  beforeEach(() => {
    posthogMock.init.mockClear();
    posthogMock.capture.mockClear();
    document.head.innerHTML = '';
  });

  afterEach(() => {
    vi.resetModules();
    document.head.innerHTML = '';
  });

  it('does not init when server flag is false', async () => {
    setPostHogMetaTags({ enabled: 'false', apiKey: 'phc_test' });

    const { initAnalytics } = await loadPosthogModule();
    initAnalytics();

    expect(posthogMock.init).not.toHaveBeenCalled();
  });

  it('inits posthog when enabled via meta tags from proxy config', async () => {
    setPostHogMetaTags({
      enabled: 'true',
      apiKey: 'phc_test',
      host: 'https://eu.i.posthog.com',
    });

    const { initAnalytics } = await loadPosthogModule();
    initAnalytics();

    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://eu.i.posthog.com',
        capture_pageview: false,
      })
    );
  });

  it('does not init without api key in meta tags', async () => {
    setPostHogMetaTags({ enabled: 'true', apiKey: '' });

    const { initAnalytics } = await loadPosthogModule();
    initAnalytics();

    expect(posthogMock.init).not.toHaveBeenCalled();
  });

  it('captureEvent is a no-op before init', async () => {
    const { captureEvent } = await loadPosthogModule();
    captureEvent('test_event');
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('isFeatureEnabled returns default when analytics is off', async () => {
    const { isFeatureEnabled } = await loadPosthogModule();
    expect(isFeatureEnabled('upload-ui', false)).toBe(false);
  });
});
