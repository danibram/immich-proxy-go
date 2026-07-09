import { describe, expect, it } from 'vitest';
import { coarseEta, ThroughputEstimator } from './throughput';

describe('ThroughputEstimator', () => {
  it('has no estimate before two samples', () => {
    const est = new ThroughputEstimator();
    expect(est.bytesPerSecond).toBeNull();
    est.update(0, 0);
    expect(est.bytesPerSecond).toBeNull();
    expect(est.etaSeconds(1000)).toBeNull();
  });

  it('first rate sample seeds the EMA directly', () => {
    const est = new ThroughputEstimator(0.1);
    est.update(0, 0);
    est.update(1000, 1000); // 1000 B in 1s
    expect(est.bytesPerSecond).toBe(1000);
  });

  it('smooths subsequent samples with alpha = 0.1', () => {
    const est = new ThroughputEstimator(0.1);
    est.update(0, 0);
    est.update(1000, 1000); // seed: 1000 B/s
    est.update(3000, 2000); // instant rate 2000 B/s
    // 0.1 * 2000 + 0.9 * 1000 = 1100
    expect(est.bytesPerSecond).toBeCloseTo(1100, 5);
  });

  it('ignores samples closer than 250ms', () => {
    const est = new ThroughputEstimator(0.1);
    est.update(0, 0);
    est.update(1000, 1000);
    est.update(999999, 1100); // 100ms later: ignored
    expect(est.bytesPerSecond).toBe(1000);
  });

  it('re-baselines when the byte count goes backwards (retry reset)', () => {
    const est = new ThroughputEstimator(0.1);
    est.update(0, 0);
    est.update(1000, 1000);
    est.update(500, 2000); // a retry reset a file's progress
    expect(est.bytesPerSecond).toBe(1000); // unchanged, no negative rate
    est.update(1500, 3000); // 1000 B over 1s from the new baseline
    expect(est.bytesPerSecond).toBeCloseTo(0.1 * 1000 + 0.9 * 1000, 5);
  });

  it('computes ETA from the smoothed rate', () => {
    const est = new ThroughputEstimator(0.1);
    est.update(0, 0);
    est.update(1000, 1000); // 1000 B/s
    expect(est.etaSeconds(5000)).toBeCloseTo(5, 5);
    expect(est.etaSeconds(0)).toBe(0);
  });
});

describe('coarseEta', () => {
  it('buckets sub-minute estimates into 10s steps', () => {
    expect(coarseEta(3)).toEqual({ unit: 'seconds', value: 10 });
    expect(coarseEta(12)).toEqual({ unit: 'seconds', value: 20 });
    expect(coarseEta(59)).toEqual({ unit: 'seconds', value: 60 });
  });

  it('uses minutes up to 90 minutes', () => {
    expect(coarseEta(240)).toEqual({ unit: 'minutes', value: 4 });
    expect(coarseEta(60)).toEqual({ unit: 'minutes', value: 1 });
    expect(coarseEta(89 * 60)).toEqual({ unit: 'minutes', value: 89 });
  });

  it('uses hours beyond 90 minutes', () => {
    expect(coarseEta(2 * 3600)).toEqual({ unit: 'hours', value: 2 });
    expect(coarseEta(5 * 3600)).toEqual({ unit: 'hours', value: 5 });
  });
});
