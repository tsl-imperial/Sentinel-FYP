/**
 * R7: usePolygonDraw cleanup must detach event listeners AND stop the draw
 * adapter. Codex finding #6: calling draw.stop() alone is NOT proof of cleanup
 * if you also subscribed to events explicitly. Both off() and stop() must be
 * called.
 *
 * Ported from the Leaflet implementation. The new wrapper uses terra-draw, so
 * we mock terra-draw and assert the spy was called for both 'change' and
 * 'finish' off() AND for stop().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

// Track terra-draw method calls so the assertions can inspect them.
const tracker = {
  on: vi.fn(),
  off: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  setMode: vi.fn(),
  clear: vi.fn(),
  getSnapshot: vi.fn(() => []),
  reset() {
    this.on.mockClear();
    this.off.mockClear();
    this.start.mockClear();
    this.stop.mockClear();
    this.setMode.mockClear();
    this.clear.mockClear();
    this.getSnapshot.mockClear();
  },
};

vi.mock('terra-draw', () => {
  class FakeTerraDraw {
    on = tracker.on;
    off = tracker.off;
    start = tracker.start;
    stop = tracker.stop;
    setMode = tracker.setMode;
    clear = tracker.clear;
    getSnapshot = tracker.getSnapshot;
  }
  class FakeTerraDrawPolygonMode {}
  return { TerraDraw: FakeTerraDraw, TerraDrawPolygonMode: FakeTerraDrawPolygonMode };
});

vi.mock('terra-draw-maplibre-gl-adapter', () => ({
  TerraDrawMapLibreGLAdapter: class {},
}));

import { usePolygonDraw } from './usePolygonDraw';

describe('usePolygonDraw (R7)', () => {
  beforeEach(() => {
    tracker.reset();
    cleanup();
  });

  it('R7: unmount detaches both change+finish listeners AND calls draw.stop()', () => {
    // Provide a fake maplibre Map. The hook calls isStyleLoaded() to decide
    // whether to start terra-draw immediately or wait for the 'load' event,
    // so the fake must answer truthy. The on/off/once methods are stubs since
    // terra-draw itself is mocked above.
    const fakeMap = {
      isStyleLoaded: () => true,
      once: vi.fn(),
      off: vi.fn(),
    } as unknown as Parameters<typeof usePolygonDraw>[0];

    const { unmount } = renderHook(() => usePolygonDraw(fakeMap));

    // The hook subscribes to both events on mount.
    const onChangeSubscriptions = tracker.on.mock.calls.filter((c) => c[0] === 'change');
    const onFinishSubscriptions = tracker.on.mock.calls.filter((c) => c[0] === 'finish');
    expect(onChangeSubscriptions).toHaveLength(1);
    expect(onFinishSubscriptions).toHaveLength(1);
    expect(tracker.start).toHaveBeenCalled();

    // Capture the actual handler references so we can verify off() detaches the SAME ones.
    const changeHandler = onChangeSubscriptions[0]?.[1];
    const finishHandler = onFinishSubscriptions[0]?.[1];
    expect(changeHandler).toBeDefined();
    expect(finishHandler).toBeDefined();

    unmount();

    // Both off() calls must have happened.
    const offChangeCalls = tracker.off.mock.calls.filter((c) => c[0] === 'change');
    const offFinishCalls = tracker.off.mock.calls.filter((c) => c[0] === 'finish');
    expect(offChangeCalls).toHaveLength(1);
    expect(offFinishCalls).toHaveLength(1);

    // The off() handler reference must match the on() reference, otherwise
    // the listener stays attached. (This is the actual cleanup contract.)
    expect(offChangeCalls[0]?.[1]).toBe(changeHandler);
    expect(offFinishCalls[0]?.[1]).toBe(finishHandler);

    // And stop() must have been called too. Both off+stop are required per Codex finding #6.
    expect(tracker.stop).toHaveBeenCalledTimes(1);
  });

  it('does nothing when map is null', () => {
    const { result, unmount } = renderHook(() => usePolygonDraw(null));
    expect(result.current.isClosed).toBe(false);
    expect(result.current.pointCount).toBe(0);
    // No terra-draw instance constructed, so no on/off/start/stop calls.
    expect(tracker.on).not.toHaveBeenCalled();
    expect(tracker.start).not.toHaveBeenCalled();
    expect(() => unmount()).not.toThrow();
  });
});
