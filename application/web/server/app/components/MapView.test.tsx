/**
 * MapView regression tests R5 and R6.
 *
 * R5: Unmounting <MapView> must call map.remove(). React 19 strict mode in dev
 *     double-mounts effects, so a missing cleanup leaks Leaflet instances.
 * R6: Mounting <MapView> under <StrictMode> must not throw
 *     "Map container is already initialized." Strict mode runs effect cleanup
 *     between the doubled mounts, so a correct cleanup makes this safe.
 *
 * Both tests mock the leaflet module so we can verify cleanup behavior without
 * depending on Leaflet's jsdom-incompatible canvas/tile rendering. The mock
 * also enforces the "container already initialized" rule that real Leaflet
 * would enforce — that's how R6 actually exercises the constraint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StrictMode } from 'react';

// Track which DOM elements have already been claimed by an L.map() call.
// L.map() throws if the same container is reused without remove() being called first.
const initializedContainers = new WeakSet<HTMLElement>();

// Track calls so the assertions can inspect them
const tracker = {
  mapCalls: 0,
  removeCalls: 0,
  reset() {
    this.mapCalls = 0;
    this.removeCalls = 0;
  },
};

vi.mock('leaflet', () => {
  const fakeTileLayer = () => ({
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  });

  const fakeMap = (el: HTMLElement) => {
    if (initializedContainers.has(el)) {
      throw new Error('Map container is already initialized.');
    }
    initializedContainers.add(el);
    tracker.mapCalls += 1;

    type Handler = (...args: unknown[]) => void;
    const handlers = new Map<string, Set<Handler>>();

    const map = {
      _el: el,
      setView: vi.fn().mockReturnThis(),
      remove: vi.fn(() => {
        tracker.removeCalls += 1;
        initializedContainers.delete(el);
      }),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      hasLayer: vi.fn().mockReturnValue(false),
      on: vi.fn((event: string, fn: Handler) => {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(fn);
      }),
      off: vi.fn((event?: string, fn?: Handler) => {
        if (!event) {
          handlers.clear();
          return;
        }
        if (fn) handlers.get(event)?.delete(fn);
        else handlers.delete(event);
      }),
    };
    return map;
  };

  const fakeGeoJSON = vi.fn(() => ({
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  }));

  const L = {
    map: vi.fn(fakeMap),
    tileLayer: vi.fn(fakeTileLayer),
    geoJSON: fakeGeoJSON,
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

// MapView imports './globals.css' indirectly via the lib — stub the css imports
vi.mock('leaflet/dist/leaflet.css', () => ({}));

import MapView from './MapView';

describe('MapView (R5/R6)', () => {
  beforeEach(() => {
    tracker.reset();
    cleanup();
  });

  it('R5: unmounting calls map.remove()', () => {
    const onMapReady = vi.fn();
    const { unmount } = render(
      <MapView
        center={[7.95, -1.0]}
        zoom={7}
        overviewLayers={[]}
        enabled={{}}
        boundary={null}
        onMapReady={onMapReady}
      />,
    );

    expect(tracker.mapCalls).toBe(1);
    expect(tracker.removeCalls).toBe(0);
    expect(onMapReady).toHaveBeenCalledTimes(1);

    unmount();

    expect(tracker.removeCalls).toBe(1);
    // onMapReady is called with null on unmount
    expect(onMapReady).toHaveBeenLastCalledWith(null);
  });

  it('R6: mounting under StrictMode does not throw "already initialized"', () => {
    // StrictMode in dev runs every effect cleanup between the doubled mounts.
    // If the cleanup is missing, the second L.map() call throws because the
    // container is still tracked as initialized. The fact that this test
    // doesn't throw is the assertion.
    const onMapReady = vi.fn();
    expect(() => {
      render(
        <StrictMode>
          <MapView
            center={[7.95, -1.0]}
            zoom={7}
            overviewLayers={[]}
            enabled={{}}
            boundary={null}
            onMapReady={onMapReady}
          />
        </StrictMode>,
      );
    }).not.toThrow();

    // For every L.map() call there must be a balancing remove() so the
    // container is releasable. (StrictMode does mount → cleanup → mount, so
    // we expect map=2, remove=1 after a successful mount.)
    expect(tracker.mapCalls).toBeGreaterThanOrEqual(1);
    expect(tracker.mapCalls - tracker.removeCalls).toBeLessThanOrEqual(1);
  });
});
