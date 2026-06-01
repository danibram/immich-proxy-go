import { expect, test, type Page } from '@playwright/test';
import { fetchSharedLink, type SharedLinkCapabilities } from './helpers/api';
import { isIntegrationE2E, seed } from './helpers/env';
import { openShareByKey } from './helpers/share';

type Scenario = {
  title: string;
  getKey: () => string | undefined;
  skipIfMissing: string;
  assert: (page: Page, caps: SharedLinkCapabilities) => Promise<void>;
};

const scenarios: Scenario[] = [
  {
    title: 'default share UI matches API capabilities',
    getKey: () => seed.shareKey(),
    skipIfMissing: 'DEFAULT_SHARE_KEY required',
    async assert(page, caps) {
      const downloadBtn = page.getByRole('button', { name: 'Download', exact: true });
      if (caps.allowDownload) {
        await expect(downloadBtn).toBeVisible();
      } else {
        await expect(downloadBtn).toBeHidden();
      }

      await page.getByTestId('gallery-item').first().click();
      const infoBtn = page.getByRole('button', { name: 'Info', exact: true });
      if (caps.showMetadata) {
        await expect(infoBtn).toBeVisible();
      } else {
        await expect(infoBtn).toBeHidden();
      }
      await page.keyboard.press('Escape');
    },
  },
  {
    title: 'override-on share UI matches API capabilities',
    getKey: () => seed.overrideOnKey(),
    skipIfMissing: 'OVERRIDE_ON_SHARE_KEY required',
    async assert(page, caps) {
      const uploadBtn = page.getByRole('button', { name: 'Upload', exact: true });
      if (caps.allowUpload) {
        await expect(uploadBtn).toBeVisible();
      } else {
        await expect(uploadBtn).toBeHidden();
      }

      const downloadBtn = page.getByRole('button', { name: 'Download', exact: true });
      if (caps.allowDownload) {
        await expect(downloadBtn).toBeVisible();
      } else {
        await expect(downloadBtn).toBeHidden();
      }
    },
  },
  {
    title: 'override-off share hides download and upload',
    getKey: () => seed.overrideOffKey(),
    skipIfMissing: 'OVERRIDE_OFF_SHARE_KEY required',
    async assert(page, caps) {
      expect(caps.allowDownload).toBe(false);
      expect(caps.allowUpload).toBe(false);
      await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeHidden();
      await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeHidden();
    },
  },
  {
    title: 'metadata-off share hides info panel in viewer',
    getKey: () => seed.metadataOffKey(),
    skipIfMissing: 'METADATA_OFF_SHARE_KEY required',
    async assert(page, caps) {
      expect(caps.showMetadata).toBe(false);
      await page.getByTestId('gallery-item').first().click();
      await expect(page.getByRole('button', { name: 'Info', exact: true })).toBeHidden();
    },
  },
];

test.describe('Proxy and shared-link options (UI)', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL');

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  for (const scenario of scenarios) {
    test(scenario.title, async ({ page, request }) => {
      const shareKey = scenario.getKey();
      test.skip(!shareKey, scenario.skipIfMissing);

      const caps = await fetchSharedLink(request, shareKey!);
      await openShareByKey(page, shareKey!);
      await scenario.assert(page, caps);
    });
  }
});
