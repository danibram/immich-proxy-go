import { describe, expect, it } from 'vitest';
import { AdaptiveConcurrencyPolicy, DEFAULT_LARGE_FILE_BYTES } from './pool';

const MB = 1024 * 1024;
const small = { bytes: 2 * MB };
const large = { bytes: DEFAULT_LARGE_FILE_BYTES + 1 };

describe('AdaptiveConcurrencyPolicy', () => {
  it('allows up to 3 parallel uploads by default', () => {
    const policy = new AdaptiveConcurrencyPolicy();
    expect(policy.concurrency).toBe(3);
    expect(policy.canStart([], small)).toBe(true);
    expect(policy.canStart([small, small], small)).toBe(true);
    expect(policy.canStart([small, small, small], small)).toBe(false);
  });

  it('allows only one >50MB file in flight at a time', () => {
    const policy = new AdaptiveConcurrencyPolicy();
    expect(policy.canStart([], large)).toBe(true);
    expect(policy.canStart([large], large)).toBe(false);
    // Small files still flow around a large one.
    expect(policy.canStart([large], small)).toBe(true);
    expect(policy.canStart([large, small], small)).toBe(true);
  });

  it('drops toward 1 after consecutive retryable failures', () => {
    const policy = new AdaptiveConcurrencyPolicy();
    policy.noteRetryableFailure();
    expect(policy.concurrency).toBe(3); // one failure is noise
    policy.noteRetryableFailure();
    expect(policy.concurrency).toBe(2); // two in a row: back off
    policy.noteRetryableFailure();
    policy.noteRetryableFailure();
    expect(policy.concurrency).toBe(1);
    // Never below 1.
    policy.noteRetryableFailure();
    policy.noteRetryableFailure();
    expect(policy.concurrency).toBe(1);
  });

  it('a success between failures resets the failure streak', () => {
    const policy = new AdaptiveConcurrencyPolicy();
    policy.noteRetryableFailure();
    policy.noteSuccess();
    policy.noteRetryableFailure();
    expect(policy.concurrency).toBe(3);
  });

  it('recovers concurrency after consecutive successes', () => {
    const policy = new AdaptiveConcurrencyPolicy();
    // Down to 1.
    for (let i = 0; i < 4; i++) policy.noteRetryableFailure();
    expect(policy.concurrency).toBe(1);
    policy.noteSuccess();
    expect(policy.concurrency).toBe(1);
    policy.noteSuccess();
    expect(policy.concurrency).toBe(2);
    policy.noteSuccess();
    policy.noteSuccess();
    expect(policy.concurrency).toBe(3);
    // Never above max.
    policy.noteSuccess();
    policy.noteSuccess();
    expect(policy.concurrency).toBe(3);
  });
});
