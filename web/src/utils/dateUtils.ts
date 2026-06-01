import type { Asset } from '~/api/types';

export interface DateGroup {
  date: string;
  label: string;
  scrubberLabel: string;
  year: number;
  month: number;
  day: number;
  assets: Asset[];
}

export function getAssetDate(asset: Asset): Date {
  return new Date(asset.localDateTime || asset.fileCreatedAt);
}

export function getAssetDateKey(asset: Asset): string {
  const raw = asset.localDateTime || asset.fileCreatedAt;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }

  return getAssetDate(asset).toISOString().slice(0, 10);
}

export function formatDateLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

export function formatScrubberLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function groupAssetsByDate(assets: Asset[]): DateGroup[] {
  const groups = new Map<string, Asset[]>();

  for (const asset of assets) {
    const dateKey = getAssetDateKey(asset);

    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(asset);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, groupAssets]) => {
      const date = new Date(`${dateKey}T00:00:00`);
      return {
        date: dateKey,
        label: formatDateLabel(date),
        scrubberLabel: formatScrubberLabel(date),
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate(),
        assets: groupAssets.sort(
          (a, b) => getAssetDate(b).getTime() - getAssetDate(a).getTime()
        ),
      };
    });
}

export function formatDuration(duration: string): string {
  if (!duration || duration === '0:00:00.000000' || duration === '00:00:00.00000') return '';

  const parts = duration.split(':');
  if (parts.length >= 2) {
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const seconds = Math.floor(parseFloat(parts[2] || '0'));

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  return '';
}

export function formatAlbumDateRange(assetList: Asset[]): string | null {
  if (assetList.length === 0) return null;

  const dates = assetList.map(getAssetDate);
  const oldest = new Date(Math.min(...dates.map((d) => d.getTime())));
  const newest = new Date(Math.max(...dates.map((d) => d.getTime())));

  const formatMonthYear = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

  if (oldest.getMonth() === newest.getMonth() && oldest.getFullYear() === newest.getFullYear()) {
    return formatMonthYear(oldest);
  }
  return `${formatMonthYear(oldest)} – ${formatMonthYear(newest)}`;
}

export function getUniqueYears(groups: DateGroup[]): number[] {
  const years = new Set<number>();
  for (const group of groups) {
    years.add(group.year);
  }
  return Array.from(years).sort((a, b) => b - a);
}
