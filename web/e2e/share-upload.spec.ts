import { expect, test } from '@playwright/test';
import {
  downloadAssetThroughShare,
  fetchSharedAlbumAssetCount,
  fetchSharedAlbumContext,
  type ShareRoutePrefix,
  uploadAssetThroughShare,
} from './helpers/api';
import { isIntegrationE2E, seed } from './helpers/env';
import {
  getUploadFixture,
  type FixtureVariant,
  type UploadFormat,
} from './helpers/uploadFixtures';

interface RouteScenario {
  label: string;
  prefix: ShareRoutePrefix;
  fixtureVariant: FixtureVariant;
  identifier: () => string;
  missingEnv: string;
}

const routes: RouteScenario[] = [
  {
    label: 'long /share URL',
    prefix: 'share',
    fixtureVariant: 'long',
    identifier: seed.overrideOnKey,
    missingEnv: 'OVERRIDE_ON_SHARE_KEY required',
  },
  {
    label: 'short /s URL',
    prefix: 's',
    fixtureVariant: 'short',
    identifier: seed.overrideOnSlug,
    missingEnv: 'OVERRIDE_ON_SHARE_SLUG required',
  },
];

const formats: UploadFormat[] = ['png', 'jpg', 'heic'];

test.describe('Shared album uploads', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL');

  for (const routeScenario of routes) {
    for (const format of formats) {
      test(`${routeScenario.label} uploads ${format.toUpperCase()} to its album`, async ({
        request,
      }) => {
        const identifier = routeScenario.identifier();
        test.skip(!identifier, routeScenario.missingEnv);

        const route = { prefix: routeScenario.prefix, identifier };
        const fixture = getUploadFixture(routeScenario.fixtureVariant, format);
        const album = await fetchSharedAlbumContext(request, route);
        const upload = await uploadAssetThroughShare(request, route, {
          ...fixture,
          filename: `${routeScenario.fixtureVariant}-upload.${fixture.extension}`,
        });

        if (upload.status === 'created') {
          await expect
            .poll(() => fetchSharedAlbumAssetCount(request, route, album.albumId), {
              message: `${format} upload should increase the shared album asset count`,
            })
            .toBe(album.assetCount + 1);
        }

        const original = await downloadAssetThroughShare(request, route, upload.id);
        expect(original.equals(fixture.buffer)).toBe(true);
      });
    }
  }
});
