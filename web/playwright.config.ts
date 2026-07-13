import { defineConfig, devices } from '@playwright/test';

const externalBaseURL = process.env.E2E_EXTERNAL_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['line']],
  timeout: externalBaseURL ? 90_000 : 15_000,
  use: {
    baseURL: externalBaseURL || 'http://localhost:4173',
    // Pin the browser locale so specs that assert English UI text are
    // deterministic regardless of the CI host locale. i18n specs override
    // this per-context with test.use({ locale }).
    locale: 'en-US',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        // Serve a FRESH build: a reused preview of a stale dist/ makes specs
        // silently test old code (cost us a debugging session).
        command: 'npm run build && npm run preview -- --port 4173',
        url: 'http://localhost:4173',
        reuseExistingServer: false,
        timeout: 120000,
      },
});
