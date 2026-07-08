import { expect, test, type Page } from '@playwright/test';
import { env, isIntegrationE2E } from './helpers/env';
import { openShareByKey } from './helpers/share';

/**
 * Stress spec for the blank-tile bug class the virtual window architecture
 * fixes by construction: with per-tile lazy-load state machines, a ghost
 * <img> event after an abort could strand a visible tile blank forever.
 * With the derived window, every derivation pass self-heals, so no amount
 * of scrubbing may leave a visible tile unloaded.
 *
 * Needs the large seeded album (e2e/scripts/seed-large-album.sh, ~520
 * assets) — skipped when LARGE_SHARE_KEY is not in the environment.
 */

const LARGE_KEY = env('LARGE_SHARE_KEY');

const SCRUB_TOP_PADDING = 40;
const SCRUB_BOTTOM_PADDING = 96;

interface ViewportFill {
  visible: number;
  blank: number;
}

async function viewportFill(page: Page): Promise<ViewportFill> {
  return page.evaluate(() => {
    const scroll = document.querySelector('.album-scroll');
    if (!scroll) return { visible: 0, blank: 0 };
    const bounds = scroll.getBoundingClientRect();
    let visible = 0;
    let blank = 0;
    for (const slot of document.querySelectorAll('.thumb-img-slot')) {
      const rect = slot.getBoundingClientRect();
      if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue;
      visible++;
      const img = slot.querySelector('img');
      if (!(img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)) blank++;
    }
    return { visible, blank };
  });
}

/** Every tile inside the viewport must finish loading within 2s of settle. */
async function expectViewportFilled(page: Page, label: string) {
  await expect
    .poll(async () => viewportFill(page), {
      timeout: 2_000,
      message: `viewport should fully load after ${label}`,
    })
    .toMatchObject({ blank: 0 });
  expect((await viewportFill(page)).visible).toBeGreaterThan(0);
}

async function scrubberTrack(page: Page) {
  const scrubber = await page.locator('.scrubber').boundingBox();
  if (!scrubber) throw new Error('scrubber not visible');
  const grip = await page.locator('.scrub-grip').boundingBox();
  if (!grip) throw new Error('scrub grip not visible');
  return {
    x: grip.x + grip.width / 2,
    yTop: scrubber.y + SCRUB_TOP_PADDING,
    yBottom: scrubber.y + scrubber.height - SCRUB_BOTTOM_PADDING,
  };
}

async function dragScrubber(
  page: Page,
  fromRatio: number,
  toRatio: number,
  moves: number,
  pauseMs: number
) {
  const track = await scrubberTrack(page);
  const yFor = (ratio: number) => track.yTop + (track.yBottom - track.yTop) * ratio;

  // The grip follows the scroll position; grab it wherever it currently is.
  const grip = await page.locator('.scrub-grip').boundingBox();
  if (!grip) throw new Error('scrub grip not visible');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x, yFor(fromRatio));
  for (let i = 1; i <= moves; i++) {
    await page.mouse.move(track.x, yFor(fromRatio + ((toRatio - fromRatio) * i) / moves));
    if (pauseMs > 0) await page.waitForTimeout(pauseMs);
  }
  await page.mouse.up();
}

test.describe('Virtual window stress (integration)', () => {
  test.skip(!isIntegrationE2E(), 'Requires E2E_EXTERNAL_BASE_URL (docker compose stack)');
  test.skip(!LARGE_KEY, 'Requires LARGE_SHARE_KEY (e2e/scripts/seed-large-album.sh)');

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test('aggressive scrubber drags never strand blank tiles', async ({ page }) => {
    test.setTimeout(240_000);
    await openShareByKey(page, LARGE_KEY);
    await expectViewportFilled(page, 'initial load');

    // 5 cycles of top->bottom->random-midpoint drags at varying speeds.
    const midpoints = [0.31, 0.77, 0.12, 0.58, 0.93];
    for (let cycle = 0; cycle < 5; cycle++) {
      await dragScrubber(page, 0, 1, 25, 15); // fast sweep down
      await dragScrubber(page, 1, 0, 40, 45); // slower sweep up
      await dragScrubber(page, 0, midpoints[cycle], 12, 25); // dart to a midpoint

      await expectViewportFilled(page, `drag cycle ${cycle + 1}`);
    }
  });

  test('slow wheel through random sections leaves no persistent blank tiles', async ({ page }) => {
    test.setTimeout(240_000);
    await openShareByKey(page, LARGE_KEY);
    await expectViewportFilled(page, 'initial load');

    const box = await page.locator('.album-scroll').boundingBox();
    if (!box) throw new Error('scroll container not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    const sections = [0.2, 0.55, 0.85];
    for (const section of sections) {
      await page.evaluate((ratio) => {
        const el = document.querySelector('.album-scroll') as HTMLElement;
        el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
      }, section);
      await expectViewportFilled(page, `jump to section ${section}`);

      for (let step = 0; step < 8; step++) {
        await page.mouse.wheel(0, 320);
        await page.waitForTimeout(120);
      }
      await expectViewportFilled(page, `wheel through section ${section}`);
    }
  });
});
