import posthog from 'posthog-js';
import { isPostHogAllowed, readPostHogBuildConfig } from './env';
import type { ShareContextProperties } from './types';

let initialized = false;
let ready = false;
const readyCallbacks: Array<() => void> = [];

function notifyReady() {
  ready = true;
  for (const cb of readyCallbacks) {
    cb();
  }
  readyCallbacks.length = 0;
}

function isEnabled(): boolean {
  return initialized;
}

export function initAnalytics(): void {
  if (initialized || typeof window === 'undefined') {
    return;
  }

  if (!isPostHogAllowed()) {
    return;
  }

  const build = readPostHogBuildConfig();
  if (!build.apiKey) {
    return;
  }

  posthog.init(build.apiKey, {
    api_host: build.host,
    autocapture: build.autocapture,
    capture_pageview: false,
    capture_pageleave: true,
    disable_session_recording: build.disableSessionRecording,
    persistence: 'localStorage+cookie',
    respect_dnt: true,
  });

  posthog.register({
    app: 'immich-proxy-go',
  });

  initialized = true;

  posthog.onFeatureFlags(() => {
    notifyReady();
  });

  window.setTimeout(() => {
    if (!ready) {
      notifyReady();
    }
  }, 1500);
}

export function onAnalyticsReady(callback: () => void): void {
  if (ready) {
    callback();
    return;
  }
  readyCallbacks.push(callback);
}

export function capturePageview(path?: string): void {
  if (!isEnabled()) {
    return;
  }
  posthog.capture('$pageview', {
    $current_url: path ?? window.location.pathname,
  });
}

export function captureEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null | undefined>
): void {
  if (!isEnabled()) {
    return;
  }
  posthog.capture(event, properties);
}

export function registerShareContext(properties: ShareContextProperties): void {
  if (!isEnabled()) {
    return;
  }
  posthog.register(properties);
}

export function unregisterShareContext(): void {
  if (!isEnabled()) {
    return;
  }
  posthog.unregister('share_route_type');
  posthog.unregister('link_type');
  posthog.unregister('asset_count');
  posthog.unregister('allow_upload');
  posthog.unregister('allow_download');
  posthog.unregister('show_metadata');
}

export function registerPage(page: 'home' | 'share'): void {
  if (!isEnabled()) {
    return;
  }
  posthog.register({ page });
}

export function unregisterPage(): void {
  if (!isEnabled()) {
    return;
  }
  posthog.unregister('page');
}

export function isFeatureEnabled(flag: string, defaultValue = true): boolean {
  if (!isEnabled()) {
    return defaultValue;
  }
  const value = posthog.isFeatureEnabled(flag);
  if (value === undefined) {
    return defaultValue;
  }
  return value;
}
