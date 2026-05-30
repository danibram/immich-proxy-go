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
    vi.stubGlobal('window', {
      ...globalThis.window,
      __IPP_POSTHOG_ENABLED__: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not init when server flag is false', async () => {
    window.__IPP_POSTHOG_ENABLED__ = false;
    vi.stubEnv('VITE_POSTHOG_API_KEY', 'phc_test');

    const { initAnalytics } = await loadPosthogModule();
    initAnalytics();

    expect(posthogMock.init).not.toHaveBeenCalled();
  });

  it('inits posthog when enabled and api key is set at build time', async () => {
    window.__IPP_POSTHOG_ENABLED__ = true;
    vi.stubEnv('VITE_POSTHOG_API_KEY', 'phc_test');
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://eu.i.posthog.com');

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

  it('does not init without api key', async () => {
    window.__IPP_POSTHOG_ENABLED__ = true;
    vi.stubEnv('VITE_POSTHOG_API_KEY', '');

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
