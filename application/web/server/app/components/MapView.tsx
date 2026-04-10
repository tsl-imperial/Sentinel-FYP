'use client';

/**
 * MapView — vanilla Leaflet inside a useRef + useEffect.
 *
 * MUST be loaded via next/dynamic with { ssr: false } because Leaflet touches
 * `window` at module load and crashes Next.js SSR/SSG.
 *
 * REGRESSION R5/R6: cleanup MUST call map.remove() to satisfy React 19 strict
 * mode's double-mount of effects in dev. Without this, mounting the workbench
 * twice produces "Map container is already initialized."
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { createMap } from '@/lib/leaflet';
import type { OverviewLayer } from '@/lib/schemas/overviewLayers';
import type { BoundaryLayer } from '@/lib/schemas/boundaryLayer';

export interface MapViewProps {
  center: [number, number];
  zoom: number;
  overviewLayers: OverviewLayer[];
  enabled: Record<string, boolean>;
  boundary: BoundaryLayer | null;
  /** Receives the Leaflet map instance after init, and null on unmount. */
  onMapReady: (map: L.Map | null) => void;
}

// Line widths per OSM road class. Trunk visible at all zooms, residential thin.
// Could come from the backend alongside `color` if we want a single source of
// truth — for now this is the only place line widths exist.
const WIDTHS: Record<string, number> = {
  trunk: 3,
  trunk_link: 2,
  primary: 2.5,
  primary_link: 2,
  secondary: 2,
  secondary_link: 1.5,
  tertiary: 1.5,
  tertiary_link: 1.2,
  residential: 1,
  service: 1,
  unclassified: 1,
};

function buildPopup(name: string, fclass: string, color: string): HTMLDivElement {
  // DOM node, not innerHTML — auto-escapes any user-supplied OSM road name.
  const div = document.createElement('div');
  div.style.cssText = 'font-family:Inter,system-ui,sans-serif;font-size:11px;color:#334155';
  const strong = document.createElement('b');
  strong.style.color = '#0f172a';
  strong.textContent = name;
  div.appendChild(strong);
  div.appendChild(document.createElement('br'));
  const dot = document.createElement('span');
  dot.style.color = color;
  dot.textContent = '● ';
  div.appendChild(dot);
  div.appendChild(document.createTextNode(fclass));
  return div;
}

function isLayerVisible(enabled: Record<string, boolean>, cls: string): boolean {
  // Single source of truth for "is this class enabled?". Default to visible
  // when the user hasn't toggled the class. Mirrors ClassLayerLegend's default.
  return enabled[cls] !== false;
}

export default function MapView({
  center,
  zoom,
  overviewLayers,
  enabled,
  boundary,
  onMapReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRegistryRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const boundaryRef = useRef<L.GeoJSON | null>(null);
  const lastBoundaryDataRef = useRef<BoundaryLayer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = createMap(containerRef.current, center, zoom);
    mapRef.current = map;
    onMapReady(map);

    return () => {
      onMapReady(null);
      map.remove();
      mapRef.current = null;
      layerRegistryRef.current.clear();
      boundaryRef.current = null;
      lastBoundaryDataRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const registry = layerRegistryRef.current;

    const incomingClasses = new Set(overviewLayers.map((l) => l.class));

    for (const [cls, layer] of registry.entries()) {
      if (!incomingClasses.has(cls)) {
        if (map.hasLayer(layer)) map.removeLayer(layer);
        registry.delete(cls);
      }
    }

    for (const layerInfo of overviewLayers) {
      let geo = registry.get(layerInfo.class);
      if (!geo) {
        const weight = WIDTHS[layerInfo.class] ?? 1;
        geo = L.geoJSON(layerInfo.geojson as GeoJSON.FeatureCollection, {
          style: {
            color: layerInfo.color,
            weight,
            opacity: 0.85,
            lineCap: 'round',
          },
          onEachFeature: (feature, lyr) => {
            const props = (feature.properties ?? {}) as { name?: string | null; fclass?: string };
            const name = props.name && props.name.trim() ? props.name : '(unnamed)';
            const cls = props.fclass ?? layerInfo.class;
            lyr.bindPopup(() => buildPopup(name, cls, layerInfo.color));
          },
        });
        registry.set(layerInfo.class, geo);
      }
      const shouldBeOn = isLayerVisible(enabled, layerInfo.class);
      const isOn = map.hasLayer(geo);
      if (shouldBeOn && !isOn) geo.addTo(map);
      if (!shouldBeOn && isOn) map.removeLayer(geo);
    }
  }, [overviewLayers, enabled]);

  // Boundary outline. Skip the rebuild if the data reference hasn't changed
  // (TanStack Query refetches with identical content still produce a fresh
  // wrapper, so we compare the last-rendered ref).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (boundary === lastBoundaryDataRef.current) return;
    lastBoundaryDataRef.current = boundary;

    if (boundaryRef.current) {
      map.removeLayer(boundaryRef.current);
      boundaryRef.current = null;
    }
    if (boundary) {
      boundaryRef.current = L.geoJSON(boundary.geojson as GeoJSON.FeatureCollection, {
        style: {
          color: '#0f172a',
          weight: 1.5,
          opacity: 0.9,
          fillOpacity: 0,
          dashArray: '4 4',
        },
      }).addTo(map);
    }
  }, [boundary]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView(center, zoom);
  }, [center, zoom]);

  return <div ref={containerRef} className="flex-1" style={{ minHeight: 720 }} />;
}
