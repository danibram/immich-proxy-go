import { render } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from './HomePage';

const analyticsMock = vi.hoisted(() => ({
  captureEvent: vi.fn(),
  registerPage: vi.fn(),
  unregisterPage: vi.fn(),
}));

vi.mock('~/analytics', () => analyticsMock);

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tracks home_viewed on mount', () => {
    render(() => <HomePage />);

    expect(analyticsMock.registerPage).toHaveBeenCalledWith('home');
    expect(analyticsMock.captureEvent).toHaveBeenCalledWith('home_viewed');
  });

  it('unregisters page on unmount', () => {
    const { unmount } = render(() => <HomePage />);
    unmount();
    expect(analyticsMock.unregisterPage).toHaveBeenCalled();
  });
});
