/**
 * Leaflet helpers.
 *
 * Do NOT import this file from any module that runs during Next.js SSR/SSG.
 * Leaflet's global `window` reference crashes on the server. The MapView
 * component is loaded via `next/dynamic({ ssr: false })` for that reason.
 *
 * Note: leaflet's CSS is imported from app/layout.tsx, NOT here. Side-effect
 * CSS imports inside dynamic-import chains don't reliably make it into the
 * page's CSS chunk in Next.js App Router.
 */
import L from 'leaflet';

const BASEMAP_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

const BASEMAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · CARTO · Earth Engine';

/**
 * Initialise a Leaflet map on the given DOM element.
 * Caller is responsible for calling map.remove() in cleanup.
 */
export function createMap(
  el: HTMLElement,
  center: L.LatLngExpression,
  zoom: number,
): L.Map {
  const map = L.map(el, {
    zoomControl: true,
    doubleClickZoom: false, // we use dblclick to close the polygon
  }).setView(center, zoom);

  L.tileLayer(BASEMAP_URL, {
    attribution: BASEMAP_ATTRIBUTION,
    maxZoom: 19,
  }).addTo(map);

  return map;
}

export { L };
