/**
 * Side-effect import: registers the pmtiles:// protocol with maplibre-gl so
 * any source URL of the form `pmtiles:///tiles/ghana_roads.pmtiles` is
 * intercepted and served via HTTP byte-range reads against the static file.
 *
 * Module-level guard makes this idempotent across Next.js HMR re-imports and
 * React 19 strict-mode double-mounts.
 *
 * Do NOT import from any module that runs during SSR/SSG — maplibre-gl touches
 * `window` at module load. MapView is loaded via `next/dynamic({ ssr: false })`
 * for that reason.
 */
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

declare global {
  var __netinspectPmtilesRegistered: boolean | undefined;
}

if (!globalThis.__netinspectPmtilesRegistered) {
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  globalThis.__netinspectPmtilesRegistered = true;
}
