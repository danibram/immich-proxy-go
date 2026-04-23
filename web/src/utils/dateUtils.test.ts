import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '~/api/types';
import {
  formatDateLabel,
  formatDuration,
  formatScrubberLabel,
  getUniqueYears,
  groupAssetsByDate,
} from './dateUtils';

describe('Date Utils', () => {
  describe('formatDateLabel', () => {
    beforeEach(() => {
      // Mock current date to 2024-01-20
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-20T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "Today" for today', () => {
      const today = new Date('2024-01-20T10:00:00Z');
      expect(formatDateLabel(today)).toBe('Today');
    });

    it('returns "Yesterday" for yesterday', () => {
      const yesterday = new Date('2024-01-19T10:00:00Z');
      expect(formatDateLabel(yesterday)).toBe('Yesterday');
    });

    it('returns formatted date for other days in same year', () => {
      const date = new Date('2024-01-15T10:00:00Z');
      const result = formatDateLabel(date);
      expect(result).toContain('15');
      // Check for either English or Spanish month name (locale-dependent)
      expect(result.toLowerCase()).toMatch(/january|enero/);
    });

    it('includes year for dates in different year', () => {
      const date = new Date('2023-06-15T10:00:00Z');
      const result = formatDateLabel(date);
      expect(result).toContain('2023');
    });
  });

  describe('formatScrubberLabel', () => {
    it('formats date with day, month, and year', () => {
      const date = new Date('2024-01-15T10:00:00Z');
      const result = formatScrubberLabel(date);
      expect(result).toContain('15');
      expect(result).toContain('2024');
    });
  });

  describe('groupAssetsByDate', () => {
    const assets: Asset[] = [
      { id: 'a1', type: 'IMAGE', originalFileName: 'photo1.jpg', fileCreatedAt: '2024-01-15T10:00:00Z' },
      { id: 'a2', type: 'IMAGE', originalFileName: 'photo2.jpg', fileCreatedAt: '2024-01-15T14:00:00Z' },
      { id: 'a3', type: 'IMAGE', originalFileName: 'photo3.jpg', fileCreatedAt: '2024-01-16T10:00:00Z' },
      { id: 'a4', type: 'VIDEO', originalFileName: 'video1.mp4', fileCreatedAt: '2024-01-14T08:00:00Z' },
    ];

    it('groups assets by date', () => {
      const groups = groupAssetsByDate(assets);
      expect(groups.length).toBe(3); // 3 different dates
    });

    it('sorts groups by date descending (newest first)', () => {
      const groups = groupAssetsByDate(assets);
      expect(groups[0].date).toBe('2024-01-16');
      expect(groups[1].date).toBe('2024-01-15');
      expect(groups[2].date).toBe('2024-01-14');
    });

    it('puts multiple assets in same date group', () => {
      const groups = groupAssetsByDate(assets);
      const jan15Group = groups.find(g => g.date === '2024-01-15');
      expect(jan15Group?.assets.length).toBe(2);
    });

    it('sorts assets within group by time descending', () => {
      const groups = groupAssetsByDate(assets);
      const jan15Group = groups.find(g => g.date === '2024-01-15')!;

      // 14:00 should come before 10:00
      expect(jan15Group.assets[0].id).toBe('a2');
      expect(jan15Group.assets[1].id).toBe('a1');
    });

    it('includes year, month, day in each group', () => {
      const groups = groupAssetsByDate(assets);
      const jan16Group = groups[0];

      expect(jan16Group.year).toBe(2024);
      expect(jan16Group.month).toBe(0); // January = 0
      expect(jan16Group.day).toBe(16);
    });

    it('returns empty array for empty input', () => {
      const groups = groupAssetsByDate([]);
      expect(groups).toEqual([]);
    });
  });

  describe('formatDuration', () => {
    it('returns empty string for zero duration', () => {
      expect(formatDuration('0:00:00.000000')).toBe('');
      expect(formatDuration('00:00:00.00000')).toBe('');
    });

    it('returns empty string for undefined/empty', () => {
      expect(formatDuration('')).toBe('');
      expect(formatDuration(undefined as any)).toBe('');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration('0:01:30.000000')).toBe('1:30');
      expect(formatDuration('0:05:45.500000')).toBe('5:45');
    });

    it('formats hours, minutes, and seconds', () => {
      expect(formatDuration('1:30:45.000000')).toBe('1:30:45');
      expect(formatDuration('2:05:03.000000')).toBe('2:05:03');
    });

    it('pads minutes and seconds with zeros', () => {
      expect(formatDuration('1:05:03.000000')).toBe('1:05:03');
      expect(formatDuration('0:00:05.000000')).toBe('0:05');
    });
  });

  describe('getUniqueYears', () => {
    it('extracts unique years from groups', () => {
      const groups = [
        { date: '2024-01-15', year: 2024, month: 0, day: 15, label: '', scrubberLabel: '', assets: [] },
        { date: '2024-06-20', year: 2024, month: 5, day: 20, label: '', scrubberLabel: '', assets: [] },
        { date: '2023-12-25', year: 2023, month: 11, day: 25, label: '', scrubberLabel: '', assets: [] },
      ];

      const years = getUniqueYears(groups);
      expect(years).toEqual([2024, 2023]);
    });

    it('sorts years descending', () => {
      const groups = [
        { date: '2022-01-15', year: 2022, month: 0, day: 15, label: '', scrubberLabel: '', assets: [] },
        { date: '2024-06-20', year: 2024, month: 5, day: 20, label: '', scrubberLabel: '', assets: [] },
        { date: '2023-12-25', year: 2023, month: 11, day: 25, label: '', scrubberLabel: '', assets: [] },
      ];

      const years = getUniqueYears(groups);
      expect(years).toEqual([2024, 2023, 2022]);
    });

    it('returns empty array for empty input', () => {
      expect(getUniqueYears([])).toEqual([]);
    });
  });
});
