/**
 * useDebouncedCallback — trailing edge debounce with cleanup.
 *
 * Tested correctness properties (eng-review Section 2 Issue 9):
 *  1. Trailing edge fires after `delay` ms of quiet
 *  2. Rapid calls reset the timer
 *  3. Latest fn is always read (no stale closure)
 *  4. Unmount clears any pending timer (no fire after unmount)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedCallback } from './useDebounce';

describe('useDebouncedCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the trailing edge after `delay` ms of quiet', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(fn, 100));

    act(() => {
      result.current('a');
    });
    expect(fn).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('rapid calls reset the timer (only the last call fires)', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(fn, 100));

    act(() => {
      result.current('a');
    });
    act(() => {
      vi.advanceTimersByTime(50);
      result.current('b');
    });
    act(() => {
      vi.advanceTimersByTime(50);
      result.current('c');
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('latest fn is always read (no stale closure)', () => {
    let counter = 0;
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) =>
        useDebouncedCallback(() => {
          counter = value;
        }, 100),
      { initialProps: { value: 1 } },
    );

    act(() => {
      result.current();
    });

    // Re-render with a new closure capturing a new value BEFORE the timer fires.
    rerender({ value: 42 });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(counter).toBe(42);
  });

  it('unmount clears any pending timer (no fire after unmount)', () => {
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(fn, 100));

    act(() => {
      result.current('pending');
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(fn).not.toHaveBeenCalled();
  });
});
