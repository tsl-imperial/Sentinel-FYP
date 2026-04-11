/**
 * R9 (mandatory regression) — `useMapEvent` cleanup contract.
 *
 * The 4 new map instruments (CompassRose, MapScaleBar, CoordsHud, hover
 * handler) all subscribe to MapLibre events through this single hook. If
 * the cleanup contract leaks, every instrument leaks too — silently.
 *
 * R9 mirrors the R7 contract for `usePolygonDraw`: assert that
 * `map.off(event, handler)` is called with the same handler reference that
 * was passed to `map.on(event, handler)` during the unmount cleanup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapEvent } from './useMapEvent';

interface FakeMap {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

function makeFakeMap(): FakeMap {
  return {
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('useMapEvent (R9)', () => {
  beforeEach(() => {
    // no shared state
  });

  it('R9: subscribes on mount via map.on(event, handler)', () => {
    const map = makeFakeMap();
    const handler = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => useMapEvent(map as any, 'move', handler));

    expect(map.on).toHaveBeenCalledTimes(1);
    expect(map.on).toHaveBeenCalledWith('move', handler);
  });

  it('R9: unsubscribes on unmount with the same handler reference', () => {
    const map = makeFakeMap();
    const handler = vi.fn();

    const { unmount } = renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useMapEvent(map as any, 'move', handler),
    );

    unmount();

    expect(map.off).toHaveBeenCalledTimes(1);
    expect(map.off).toHaveBeenCalledWith('move', handler);
    // Most important: the handler ref passed to off matches the one
    // passed to on. If these diverge the listener leaks silently.
    const onHandler = map.on.mock.calls[0]?.[1];
    const offHandler = map.off.mock.calls[0]?.[1];
    expect(onHandler).toBe(offHandler);
  });

  it('R9: re-subscribes when handler reference changes', () => {
    const map = makeFakeMap();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ handler }: { handler: () => void }) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useMapEvent(map as any, 'move', handler),
      { initialProps: { handler: handler1 } },
    );

    expect(map.on).toHaveBeenCalledTimes(1);
    expect(map.off).toHaveBeenCalledTimes(0);

    rerender({ handler: handler2 });

    // Effect re-ran: cleanup the old subscription, then attach the new one.
    expect(map.off).toHaveBeenCalledTimes(1);
    expect(map.off).toHaveBeenCalledWith('move', handler1);
    expect(map.on).toHaveBeenCalledTimes(2);
    expect(map.on).toHaveBeenLastCalledWith('move', handler2);

    unmount();

    expect(map.off).toHaveBeenCalledTimes(2);
    expect(map.off).toHaveBeenLastCalledWith('move', handler2);
  });

  it('R9: no-op when map is null (mount before map ready)', () => {
    const handler = vi.fn();

    const { unmount } = renderHook(() => useMapEvent(null, 'move', handler));

    // Nothing was subscribed; nothing to unsubscribe. unmount must not throw.
    expect(() => unmount()).not.toThrow();
  });
});
