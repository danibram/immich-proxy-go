import { describe, expect, it } from 'vitest';
import type { Asset } from '~/api/types';
import { buildExifRows, formatViewerFootDate, formatViewerFootSubtitle } from './viewerFormat';

const baseAsset: Asset = {
  id: 'a1',
  deviceAssetId: '',
  deviceId: '',
  ownerId: '',
  type: 'IMAGE',
  originalPath: '',
  originalFileName: 'IMG_1234.jpg',
  thumbhash: '',
  fileCreatedAt: '2024-06-15T14:30:00Z',
  fileModifiedAt: '',
  localDateTime: '2024-06-15T14:30:00Z',
  updatedAt: '',
  isFavorite: false,
  isArchived: false,
  isTrashed: false,
  isOffline: false,
  duration: '',
  hasMetadata: true,
  checksum: '',
  exifInfo: {
    make: 'Apple',
    model: 'iPhone 15',
    lensModel: 'Main',
    fNumber: 1.8,
    focalLength: 24,
    iso: 100,
    exposureTime: '1/120',
    exifImageWidth: 4032,
    exifImageHeight: 3024,
    fileSizeInByte: 2_500_000,
    city: 'Lisbon',
    country: 'Portugal',
  },
};

describe('viewerFormat', () => {
  it('builds exif rows from asset metadata', () => {
    const rows = buildExifRows(baseAsset);
    expect(rows.some((r) => r.label === 'Camera' && r.value.includes('Apple'))).toBe(true);
    expect(rows.some((r) => r.label === 'Location' && r.value.includes('Lisbon'))).toBe(true);
  });

  it('formats foot subtitle with time and place', () => {
    const subtitle = formatViewerFootSubtitle(baseAsset);
    expect(subtitle).toContain('Lisbon');
    expect(subtitle).toContain('·');
  });

  it('formats foot date', () => {
    expect(formatViewerFootDate(baseAsset)).toMatch(/2024|June|15/);
  });
});
