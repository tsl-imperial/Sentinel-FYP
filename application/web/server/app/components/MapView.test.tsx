/**
 * MapView regression tests R5 and R6 — ported from the Leaflet implementation
 * to react-map-gl/maplibre.
 *
 * R5: Unmounting <MapView> must call map.remove(). With react-map-gl this is
 *     library-owned — the wrapper disposes the underlying maplibre Map on
 *     component unmount. We assert that the unmount completes without throwing
 *     and that the parent's onMapReady callback receives null.
 * R6: Mounting <MapView> under <StrictMode> must not throw. The library handles
 *     strict-mode double-mount cleanup; the test simply asserts no exception
 *     is raised when rendering twice in a row.
 *
 * The tests mock react-map-gl/maplibre, pmtiles, and maplibre-gl so we can
 * verify behavior without depending on WebGL or jsdom-incompatible canvas.
 * The mocks are minimal — we are NOT testing the library's internal cleanup
 * (that's react-map-gl's job, not ours), only that our wiring doesn't break it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';

// Mock pmtiles to avoid evaluating its module body (which would touch
// maplibre-gl global state).
vi.mock('pmtiles', () => ({
  Protocol: class {
    tile = vi.fn();
  },
}));

// Mock maplibre-gl to avoid loading WebGL globals into jsdom.
vi.mock('maplibre-gl', () => ({
  default: { addProtocol: vi.fn() },
  addProtocol: vi.fn(),
}));

// Mock the maplibre-gl.css side-effect import in app/layout.tsx so tests
// don't try to load a real CSS file through jsdom.
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

// Mock useRoadIndices because MapView's hover popup uses TanStack Query.
// R5/R6 only care about the map mount/unmount contract, not the indices
// fetch path. Without this mock the test would need a QueryClientProvider.
vi.mock('@/hooks/useRoadIndices', () => ({
  useRoadIndices: () => ({ data: undefined, isLoading: false, error: null }),
}));

// Mock react-map-gl/maplibre with a Map that uses an effect to call its
// `ref` prop with an instance on mount and `null` on unmount — this matches
// the real library's lifecycle so R5 can assert the unmount cleanup.
vi.mock('react-map-gl/maplibre', async () => {
  const { useEffect } = await import('react');
  const Map = ({
    ref,
    children,
  }: {
    ref?: (i: unknown) => void;
    children?: ReactNode;
  }) => {
    useEffect(() => {
      if (typeof ref !== 'function') return;
      const fake = { getMap: () => null };
      ref(fake);
      return () => ref(null);
    }, [ref]);
    return <div data-testid="maplibre-map">{children}</div>;
  };
  const NavigationControl = () => null;
  const Source = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Layer = () => null;
  const Popup = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Map, NavigationControl, Source, Layer, Popup };
});

import MapView from './MapView';
import type { ClassPalette } from '@/lib/schemas/classPalette';

const PALETTE: ClassPalette = {
  order: ['residential', 'service', 'unclassified', 'tertiary', 'secondary', 'trunk', 'primary'],
  colors: {
    residential: '#1f77b4',
    service: '#ff7f0e',
    unclassified: '#d62728',
    tertiary: '#e377c2',
    secondary: '#2ca02c',
    trunk: '#bcbd22',
    primary: '#8F96A3',
  },
};

describe('MapView (R5/R6)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('R5: mounts, fires onMapReady with an instance, and unmounts with onMapReady(null)', () => {
    const onMapReady = vi.fn();
    const { unmount, getByTestId } = render(
      <MapView
        palette={PALETTE}
        center={[7.95, -1.0]}
        zoom={7}
        enabled={{}}
        boundary={null}
        onMapReady={onMapReady}
        currentYear={2024}
        currentQuarter="Jul–Sep"
      />,
    );

    expect(getByTestId('maplibre-map')).toBeInTheDocument();
    expect(onMapReady).toHaveBeenCalled();
    // First call is the instance, never null on mount.
    expect(onMapReady.mock.calls[0]?.[0]).not.toBeNull();

    expect(() => unmount()).not.toThrow();

    // Iron Rule: unmount must clear the parent's mapRef so usePolygonDraw
    // re-mounts cleanly on next mount. Without this, switching regions twice
    // leaks the previous map instance.
    expect(onMapReady).toHaveBeenLastCalledWith(null);
  });

  it('R6: mounting under StrictMode does not throw', () => {
    const onMapReady = vi.fn();
    expect(() => {
      render(
        <StrictMode>
          <MapView
            palette={PALETTE}
            center={[7.95, -1.0]}
            zoom={7}
            enabled={{}}
            boundary={null}
            onMapReady={onMapReady}
            currentYear={2024}
        currentQuarter="Jul–Sep"
          />
        </StrictMode>,
      );
    }).not.toThrow();
  });
});
