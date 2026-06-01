import type { Asset } from '~/api/types';
import { formatDuration } from '~/utils/dateUtils';

export interface ExifRow {
  id: string;
  label: string;
  value: string;
}

function assetDate(asset: Asset): Date | null {
  const raw = asset.exifInfo?.dateTimeOriginal || asset.fileCreatedAt || asset.localDateTime;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatViewerFootDate(asset: Asset): string {
  const d = assetDate(asset);
  if (!d) return '';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';

  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

export function formatViewerFootTime(asset: Asset): string {
  const d = assetDate(asset);
  if (!d) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatViewerPlace(asset: Asset): string {
  const exif = asset.exifInfo;
  if (!exif) return '';
  return [exif.city, exif.state, exif.country].filter(Boolean).join(', ');
}

export function formatViewerFootSubtitle(asset: Asset): string {
  const parts = [formatViewerFootTime(asset), formatViewerPlace(asset)].filter(Boolean);
  return parts.join(' · ');
}

export function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function formatExposureSettings(asset: Asset): string {
  const exif = asset.exifInfo;
  if (!exif) return '';

  const parts: string[] = [];
  if (exif.focalLength) parts.push(`${exif.focalLength}mm`);
  if (exif.fNumber) parts.push(`f/${exif.fNumber}`);
  if (exif.exposureTime) parts.push(exif.exposureTime);
  if (exif.iso) parts.push(`ISO ${exif.iso}`);
  return parts.join(' · ');
}

export function formatVideoDuration(duration?: string): string {
  return duration ? formatDuration(duration) : '';
}

export function buildExifRows(asset: Asset): ExifRow[] {
  const exif = asset.exifInfo;
  const rows: ExifRow[] = [];

  const camera = [exif?.make, exif?.model].filter(Boolean).join(' ');
  if (camera) rows.push({ id: 'camera', label: 'Camera', value: camera });

  if (exif?.lensModel) rows.push({ id: 'lens', label: 'Lens', value: exif.lensModel });

  const settings = formatExposureSettings(asset);
  if (settings) rows.push({ id: 'settings', label: 'Settings', value: settings });

  if (asset.originalFileName) {
    rows.push({ id: 'file', label: 'File', value: asset.originalFileName });
  }

  const dims =
    exif?.exifImageWidth && exif?.exifImageHeight
      ? `${exif.exifImageWidth} × ${exif.exifImageHeight}`
      : '';
  const size = formatFileSize(exif?.fileSizeInByte);
  const sizeLine = [dims, size].filter(Boolean).join('  ·  ');
  if (sizeLine) rows.push({ id: 'size', label: 'Dimensions', value: sizeLine });

  const time = formatViewerFootTime(asset);
  if (time) rows.push({ id: 'time', label: 'Time', value: time });

  const place = formatViewerPlace(asset);
  if (place) rows.push({ id: 'place', label: 'Location', value: place });

  if (exif?.description) rows.push({ id: 'desc', label: 'Description', value: exif.description });

  return rows;
}
