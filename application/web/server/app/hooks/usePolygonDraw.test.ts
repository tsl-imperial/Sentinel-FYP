/**
 * R7: usePolygonDraw cleanup must detach all event listeners.
 *
 * If the cleanup is broken, switching regions twice in the workbench leaks
 * 'click' and 'dblclick' handlers and produces ghost markers / double-fire bugs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { usePolygonDraw } from './usePolygonDraw';

vi.mock('leaflet', () => {
  const L = {
    polyline: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
    polygon: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
    circleMarker: vi.fn(() => ({
      addTo: vi.fn().mockReturnThis(),
      on: vi.fn(),
      off: vi.fn(),
    })),
  };
  return { default: L, ...L };
});

interface FakeMap {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  removeLayer: ReturnType<typeof vi.fn>;
  hasLayer: ReturnType<typeof vi.fn>;
}

function makeFakeMap(): FakeMap {
  return {
    on: vi.fn(),
    off: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn().mockReturnValue(false),
  };
}

describe('usePolygonDraw (R7)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('R7: unmount removes both click and dblclick listeners', () => {
    const map = makeFakeMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { unmount } = renderHook(() => usePolygonDraw(map as any));

    // The hook attaches both handlers on mount
    expect(map.on).toHaveBeenCalledWith('click', expect.any(Function));
    expect(map.on).toHaveBeenCalledWith('dblclick', expect.any(Function));

    const clickAttachCalls = map.on.mock.calls.filter((c) => c[0] === 'click').length;
    const dblclickAttachCalls = map.on.mock.calls.filter((c) => c[0] === 'dblclick').length;
    expect(clickAttachCalls).toBe(1);
    expect(dblclickAttachCalls).toBe(1);

    unmount();

    // Cleanup must detach both
    const clickDetach = map.off.mock.calls.filter((c) => c[0] === 'click').length;
    const dblclickDetach = map.off.mock.calls.filter((c) => c[0] === 'dblclick').length;
    expect(clickDetach).toBe(1);
    expect(dblclickDetach).toBe(1);

    // The detach must reference the SAME function that was attached, otherwise
    // Leaflet leaves the listener in place. Compare references.
    const clickHandlerAttached = map.on.mock.calls.find((c) => c[0] === 'click')?.[1];
    const clickHandlerDetached = map.off.mock.calls.find((c) => c[0] === 'click')?.[1];
    expect(clickHandlerDetached).toBe(clickHandlerAttached);
  });

  it('does nothing when map is null', () => {
    const { result, unmount } = renderHook(() => usePolygonDraw(null));
    expect(result.current.isClosed).toBe(false);
    expect(result.current.pointCount).toBe(0);
    // No throw on unmount
    expect(() => unmount()).not.toThrow();
  });
});
