import { describe, it, expect } from 'vitest';
import {
  buildRoadStyle,
  roadLayerId,
  roadHitLayerId,
  allRoadLayerIds,
  allHitLayerIds,
  ROADS_SOURCE_ID,
  ROADS_HOVER_LAYER_ID,
  ROADS_HOVER_NEVER_MATCH,
  PMTILES_URL,
  FALLBACK_ROAD_COLOR,
} from './maplibre-style';
import type { ClassPalette } from './schemas/classPalette';

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

describe('buildRoadStyle', () => {
  it('produces a valid style spec with version 8 and the basemap raster source', () => {
    const style = buildRoadStyle(PALETTE);
    expect(style.version).toBe(8);
    expect(style.sources).toBeDefined();
    const basemap = style.sources['basemap-raster'];
    expect(basemap).toBeDefined();
    expect(basemap?.type).toBe('raster');
  });

  it('registers the pmtiles vector source pointing at the local tile path', () => {
    const style = buildRoadStyle(PALETTE);
    const roads = style.sources[ROADS_SOURCE_ID];
    expect(roads).toBeDefined();
    expect(roads?.type).toBe('vector');
    expect((roads as { url: string }).url).toBe(PMTILES_URL);
  });

  it('paints basemap first, then per-class hit + visible layers, then hover highlight on top', () => {
    const style = buildRoadStyle(PALETTE);
    const first = style.layers[0];
    expect(first?.id).toBe('basemap');
    expect(first?.type).toBe('raster');
    // 1 basemap + 7 hit + 7 visible + 1 hover highlight = 16 layers
    expect(style.layers).toHaveLength(16);
    // Hit layers come BEFORE visible layers (so visible paints over invisible).
    const hitIdx = style.layers.findIndex((l) => l.id === roadHitLayerId('trunk'));
    const visIdx = style.layers.findIndex((l) => l.id === roadLayerId('trunk'));
    expect(hitIdx).toBeGreaterThan(0);
    expect(visIdx).toBeGreaterThan(hitIdx);
    // Hover highlight is the very last layer so it paints on top.
    const lastLayer = style.layers[style.layers.length - 1];
    expect(lastLayer?.id).toBe(ROADS_HOVER_LAYER_ID);
  });

  it('hit layers are invisible (line-opacity 0) and 14px wide', () => {
    const style = buildRoadStyle(PALETTE);
    for (const fclass of PALETTE.order) {
      const layer = style.layers.find((l) => l.id === roadHitLayerId(fclass));
      expect(layer, `hit layer for ${fclass} missing`).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paint = (layer as any).paint;
      expect(paint['line-opacity']).toBe(0);
      expect(paint['line-width']).toBe(14);
    }
  });

  it('hover highlight layer starts with a never-match filter', () => {
    const style = buildRoadStyle(PALETTE);
    const hover = style.layers.find((l) => l.id === ROADS_HOVER_LAYER_ID);
    expect(hover).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter = (hover as any).filter;
    expect(filter[0]).toBe('==');
    expect(filter[2]).toBe(ROADS_HOVER_NEVER_MATCH);
  });

  it('binds each road layer line-color to the palette entry for its fclass', () => {
    const style = buildRoadStyle(PALETTE);
    for (const fclass of PALETTE.order) {
      const layer = style.layers.find((l) => l.id === roadLayerId(fclass));
      expect(layer, `layer ${roadLayerId(fclass)} missing`).toBeDefined();
      expect(layer?.type).toBe('line');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paint = (layer as any).paint;
      expect(paint['line-color']).toBe(PALETTE.colors[fclass]);
    }
  });

  it('filters each road layer to its specific fclass via [==, get fclass, value]', () => {
    const style = buildRoadStyle(PALETTE);
    const trunkLayer = style.layers.find((l) => l.id === 'roads-trunk');
    expect(trunkLayer).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter = (trunkLayer as any).filter;
    expect(filter[0]).toBe('==');
    expect(filter[2]).toBe('trunk');
  });

  it('falls back to the slate-400 grey when a palette entry is missing', () => {
    const sparsePalette: ClassPalette = {
      order: ['mystery_class'],
      colors: {},
    };
    const style = buildRoadStyle(sparsePalette);
    const layer = style.layers.find((l) => l.id === 'roads-mystery_class');
    expect(layer).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((layer as any).paint['line-color']).toBe(FALLBACK_ROAD_COLOR);
  });

  it('width interpolates by zoom (thinner at z 6, full at z 14)', () => {
    const style = buildRoadStyle(PALETTE);
    const trunkLayer = style.layers.find((l) => l.id === 'roads-trunk');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const widthExpr = (trunkLayer as any).paint['line-width'];
    expect(widthExpr[0]).toBe('interpolate');
    // base width for trunk is 3, so at z 14 the width should be 3
    const z14Index = widthExpr.indexOf(14);
    expect(widthExpr[z14Index + 1]).toBe(3);
  });
});

describe('allRoadLayerIds', () => {
  it('returns one ID per palette entry in palette order', () => {
    expect(allRoadLayerIds(PALETTE)).toEqual([
      'roads-residential',
      'roads-service',
      'roads-unclassified',
      'roads-tertiary',
      'roads-secondary',
      'roads-trunk',
      'roads-primary',
    ]);
  });
});

describe('allHitLayerIds', () => {
  it('returns one hit layer ID per palette entry in palette order', () => {
    expect(allHitLayerIds(PALETTE)).toEqual([
      'roads-hit-residential',
      'roads-hit-service',
      'roads-hit-unclassified',
      'roads-hit-tertiary',
      'roads-hit-secondary',
      'roads-hit-trunk',
      'roads-hit-primary',
    ]);
  });
});
