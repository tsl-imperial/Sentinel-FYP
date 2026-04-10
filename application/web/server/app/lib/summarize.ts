/**
 * Pure status → user message function. Ported from app.js:100-116.
 *
 * Used by ResultsPanel to render the headline status of the most recent
 * extraction call. Inputs are the various flask response shapes plus a few
 * client-side sentinel statuses ("polygon_cleared", "region_changed", etc.).
 */
import type { ExportResponse } from './schemas/exportPolygonNetworkS2';

export type ResultStatus =
  | { kind: 'ready' }
  | { kind: 'processing' }
  | { kind: 'polygon_cleared' }
  | { kind: 'region_changed' }
  | { kind: 'error'; error: string }
  | { kind: 'ok'; result: ExportResponse; region: string };

export function summarizeResult(status: ResultStatus): string {
  switch (status.kind) {
    case 'ready':
      return 'Ready. Draw a polygon and click run to extract drivable roads + Sentinel-2 stats.';
    case 'processing':
      return 'Running extraction in backend. This can take a while for larger polygons.';
    case 'polygon_cleared':
      return 'Polygon cleared. Draw a new polygon to run extraction.';
    case 'region_changed':
      return 'Region updated and polygon reset. Draw a polygon to continue.';
    case 'error':
      return `Extraction failed: ${status.error}`;
    case 'ok': {
      const s = status.result.summary;
      if (!s) return `Completed for ${status.region}.`;
      const km = Number.isFinite(s.total_road_km) ? s.total_road_km.toFixed(2) : '-';
      const year = s.year ?? '-';
      const quarter = s.quarter ?? '-';
      return `Completed for ${status.region} (${year} ${quarter}). Extracted ${km} km across ${s.edge_count} edges / ${s.node_count} nodes.`;
    }
  }
}
