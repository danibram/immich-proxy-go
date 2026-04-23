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
    const date = new Date(asset.fileCreatedAt || asset.localDateTime);
    const dateKey = date.toISOString().split('T')[0];

    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(asset);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, groupAssets]) => {
      const date = new Date(dateKey);
      return {
        date: dateKey,
        label: formatDateLabel(date),
        scrubberLabel: formatScrubberLabel(date),
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate(),
        assets: groupAssets.sort(
          (a, b) => new Date(b.fileCreatedAt).getTime() - new Date(a.fileCreatedAt).getTime()
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

export function getUniqueYears(groups: DateGroup[]): number[] {
  const years = new Set<number>();
  for (const group of groups) {
    years.add(group.year);
  }
  return Array.from(years).sort((a, b) => b - a);
}
