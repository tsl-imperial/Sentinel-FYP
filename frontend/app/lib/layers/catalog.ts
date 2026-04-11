import type { ClassPalette } from '@/lib/schemas/classPalette';

/**
 * LayerCatalog — config-driven sidebar layer sections.
 *
 * Day 1 has one entry: "Road classes" backed by the existing class palette.
 * Tomorrow's natural additions slot into this same shape: a basemap toggle
 * (light vs dark vs satellite), a boundary layer toggle, an NDVI heatmap
 * overlay, an ESA WorldCover layer.
 *
 * Each section has a `kind` discriminator so the renderer can dispatch to
 * the right `SidebarEntry` shape (swatch vs icon, badge formatting, etc.).
 *
 * Avoiding sidebar surgery on every layer addition is the entire point —
 * rather than hardcoding "Road classes" inline in `WorkbenchSidebar.tsx`,
 * the catalog drives the render and new layers become "add a config
 * entry," not "restructure the JSX."
 */

export type LayerSection =
  | { kind: 'road-classes'; label: string; palette: ClassPalette }
  // Future variants slot in here without changing the consumer:
  // | { kind: 'basemap'; label: string; options: BasemapOption[] }
  // | { kind: 'boundary'; label: string };
  ;

export interface LayerCatalog {
  sections: LayerSection[];
}

/**
 * Build the day-1 catalog from the palette query result. The palette is
 * already gated as a load-time prerequisite for the workbench, so this
 * helper is always called with a non-null palette in production.
 */
export function buildCatalog(palette: ClassPalette): LayerCatalog {
  return {
    sections: [
      { kind: 'road-classes', label: 'Road classes', palette },
    ],
  };
}
