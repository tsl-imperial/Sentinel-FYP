# Network Inspector

Drivable road network analytics for West African corridors. Combines OpenStreetMap road geometry with Sentinel-2 surface reflectance to characterise the road network and surrounding land cover. Built at the Imperial College London Transport Systems & Logistics Laboratory (TSL) and being adapted for a World Bank pilot.

> **Repo note.** The GitHub repo is named `tsl-imperial/Sentinel-FYP` for historical reasons. The product itself is **Network Inspector**. Internal env vars and package names use the `NETINSPECT_*` / `network-inspector-*` namespace.

## Quick start

```bash
git clone <repo>
cd Sentinel-FYP
./setup.sh        # creates .venv, installs Python + Node deps, copies .env
./start.sh        # boots Flask backend + Next.js frontend in parallel
```

Open <http://127.0.0.1:3666> in your browser. Ctrl+C in the terminal stops both processes cleanly.

The default `.env.example` ships with `NETINSPECT_SKIP_EE_INIT=1`, so a **fresh checkout boots without Earth Engine credentials**. Every read endpoint serves from local files (the Geofabrik OSM extract + the per-road Sentinel-2 parquet) and you can poke at the workbench, regions, and exports pages immediately. Comment out the skip flag in `.env` once you've run `earthengine authenticate` to enable the live export pipeline.

## Requirements

- **Python 3.11+** (macOS system `python3` is 3.9, so `setup.sh` looks for `python3.13`/`python3.12`/`python3.11` first; install via `brew install python@3.13` if missing)
- **Node 20.9+** — Next.js 16 minimum. Use `nvm install 20` if you don't have it.
- **bash 3.2+** — `setup.sh` and `start.sh` are bash 3.2 compatible (macOS default), so no `wait -n`, no associative arrays.
- **Google Earth Engine** account, **optional**. Only needed for the live export pipeline (`/api/export_polygon_network_s2`'s Sentinel-2 reduction step). The rest of the app runs without it.

`./setup.sh` checks Python + Node + npm and fails loudly if anything is missing.

## Pages

| Route | Purpose |
|---|---|
| `/workbench` | The main map UI. Pick a region, draw a polygon, run an extraction. Renders OSM roads as a MapLibre GL vector layer (WebGL, served from a single ~24 MB `.pmtiles` file via HTTP byte-range reads). The region picker is camera-only — it animates a `flyTo` to the selected region's center. ALL Ghana roads remain visible at all times (panning past a region's bounds shows continuous coverage). Polygon draw is `terra-draw`: click to add vertices, double-click or click first marker to close. |
| `/regions` | Browser for the 16 Ghana administrative regions. Each card shows road km, edge count, and a class composition bar (trunk / primary / secondary / tertiary / residential / service / unclassified). Click a card → workbench preselects that region via `?region=` URL param. |
| `/exports` | Lists past extraction runs in `NETINSPECT_OUTPUT_DIR`. Groups the three sibling files per run (network pickle / edges geojson / sentinel stats) and offers download links. |
| `/about` | Static methodology page — data sources, pipeline overview, indices computed. |

## Architecture

```
                    BROWSER (localhost:3666)
                            │
                            ▼
            ┌───────────────────────────────┐
            │  Next.js 16 (Node, port 3666) │
            │  frontend/                    │
            │  - App Router pages           │
            │  - Tailwind, no UI library    │
            │  - TanStack Query             │
            │  - MapLibre GL via            │
            │    react-map-gl + terra-draw  │
            │  - PMTiles range reads from   │
            │    public/tiles/*.pmtiles     │
            └───────────────┬───────────────┘
                            │ next.config.js rewrites:
                            │   /api/:path* → http://127.0.0.1:5050/api/:path*
                            ▼
            ┌───────────────────────────────┐
            │  Flask (Python, port 5050)    │
            │  backend/app.py               │
            │  - /api/* routes              │
            │  - reads .env via dotenv      │
            │  - graceful 503 on GEE fail   │
            └───────────────┬───────────────┘
                            │
                ┌───────────┼─────────────────┐
                ▼           ▼                 ▼
         local_data.py   osmnx          earthengine-api
        (parquet+SHP)   (live OSM)         (optional)
```

The frontend and backend are **two processes** orchestrated by a single `./start.sh`. The browser only ever talks to Next.js (port 3666); Next rewrites `/api/*` calls to Flask (port 5050) so it's same-origin from the browser's perspective. No CORS in normal use.

The backend stays Python because `geopandas`, `osmnx`, `igraph`, and `earthengine-api` have no Node equivalents.

`backend/local_data.py` is the load-bearing module for the local-first data path. It reads the Geofabrik OSM shapefile, the per-road Sentinel-2 parquet, and the region lookup CSV, then serves them via cached helpers. Each region's overview/details/boundary calls hit a warm `@lru_cache` after the first request.

## Repo layout

```
.
├── .env.example              ← template; copy to .env
├── setup.sh                  ← one-time bootstrap (venv + npm install + tool checks)
├── start.sh                  ← dev orchestrator (Flask + Next.js + health gating)
├── requirements.txt          ← Python deps
├── backend/                  ← Python (Flask + data layer + GEE)
│   ├── app.py                ← Flask backend (/api/* routes)
│   ├── local_data.py         ← parquet + shapefile reader, served by /api/* read paths
│   ├── config.py             ← env-driven constants (asset IDs, road classes, colors)
│   ├── gee.py                ← Earth Engine helpers (init, region geom, S2 composites)
│   └── features.py           ← nearest-road + per-road S2 stats (export endpoint only)
├── frontend/                 ← Next.js 16 App Router
│   ├── package.json
│   ├── next.config.js
│   ├── app/
│   │   ├── layout.tsx, page.tsx, providers.tsx
│   │   ├── workbench/        ← main map UI
│   │   ├── regions/          ← region browser
│   │   ├── exports/          ← export history
│   │   ├── about/            ← methodology
│   │   ├── components/       ← Nav, MapView, ResultsPanel, ...
│   │   ├── hooks/            ← TanStack Query wrappers + usePolygonDraw
│   │   └── lib/              ← api client, schemas, format helpers
│   ├── public/
│   │   └── tiles/
│   │       └── ghana_roads.pmtiles  ← ~24 MB committed binary
│   └── tests/                ← vitest + playwright
├── scripts/
│   └── build_tiles.py        ← shapefile → tippecanoe → ghana_roads.pmtiles
├── tests/                    ← pytest suite (backend hygiene + R1-R4 regressions)
├── notebooks/                ← analysis Jupyter notebooks (not part of the web app)
├── data/                     ← OSM shapefile, parquet exports, region lookup
└── outputs/                  ← extraction outputs (gitignored)
```

## Data sources

Everything below is read by `backend/local_data.py` and served by the read endpoints. None require network or Earth Engine.

| File | Size | Source | Purpose |
|---|---|---|---|
| `data/gis_osm_roads_free_1.{shp,shx,dbf,prj,cpg}` | ~165 MB total | [Geofabrik Ghana free shapefile zip](https://download.geofabrik.de/africa/ghana-latest-free.shp.zip) | 374k road geometries with `osm_id`, `fclass`, `name`, `maxspeed`, etc. |
| `data/roads_region_lookup.csv` | 32 MB | Pre-computed (see notebooks) | 369k `osm_id → region` mappings across the 16 Ghana administrative regions |
| `data/ghana_parquet/year={2020..2023}/` | ~5M rows | Pre-computed via Earth Engine | Per-`(osm_id, fclass, quarter)` Sentinel-2 mean indices (NDVI, NDMI, NDBI, NDWI, BSI) |
| `data/ghana_q3_cloud40_parquet/year={2020..2023}/` | ~329k rows × 4 | Same | Q3-only with cloud<40% filter |

To re-download the Geofabrik shapefile, run:
```bash
curl -L -o /tmp/geofabrik-ghana.zip https://download.geofabrik.de/africa/ghana-latest-free.shp.zip
unzip -j /tmp/geofabrik-ghana.zip 'gis_osm_roads_free_1.*' -d data/
```

## Configuration

All configuration lives in a single top-level `.env`. See `.env.example` for the template. Both Flask (via `python-dotenv`) and Next.js (via `dotenv` in `next.config.js`) read from the same file, so there's no drift risk.

| Variable | Purpose | Default |
|---|---|---|
| `EE_PROJECT` | GCP project for Earth Engine | `sentinel-487715` |
| `NETINSPECT_OUTPUT_DIR` | Where extraction outputs land. Relative paths resolve to repo root, NOT CWD. | `./outputs` |
| `NETINSPECT_DEV` | Set to `1` to enable dev CORS for the Next.js dev origin. Default in `.env.example`. | unset |
| `NETINSPECT_SKIP_EE_INIT` | Set to `1` to skip `init_ee()` at app import. **Default in `.env.example` so fresh checkouts work without GEE auth.** Comment it out once you've run `earthengine authenticate`. | unset |
| `FLASK_RUN_PORT` | Flask listen port | `5050` (NOT 5000 — macOS Control Center / AirPlay Receiver binds 5000) |
| `FLASK_BACKEND_URL` | Where Next.js rewrites send `/api/*` | `http://127.0.0.1:5050` |
| `NEXT_PORT` | Next.js dev server port | `3666` (mirrors the metis house style; avoids common 3000 conflicts) |

## Testing

**Backend (pytest):**
```bash
source .venv/bin/activate
NETINSPECT_SKIP_EE_INIT=1 pytest -v
```
Tests use `mocked_ee` fixtures so they don't need real GEE credentials. The 4 backend regression tests `test_output_dir_*` (R1-R4) lock the path-resolution fix against future regressions.

**Frontend (Vitest + Playwright):**
```bash
cd frontend
npm run test          # vitest unit tests, includes R5/R6/R7 React 19 strict-mode regressions
npm run typecheck     # tsc strict
npm run lint          # eslint flat config
npm run build         # next build (compiles + prerenders all 7 routes)
npm run test:e2e      # playwright (requires the dev stack running in another terminal)
```

The mandatory regression tests:
- **R1-R4** (`tests/test_app.py`): `OUTPUT_DIR` resolution is repo-root-anchored, env-overridable, never CWD-relative
- **R5-R6** (`app/components/MapView.test.tsx`): MapView unmount calls `map.remove()`; mounting under `<StrictMode>` doesn't throw "Map container is already initialized"
- **R7** (`app/hooks/usePolygonDraw.test.ts`): cleanup detaches all map event listeners

If you're tempted to delete or skip one of these, find the explanation in the original plan first.

## Health checks

- `GET /api/healthz` — liveness probe. Cheap, no external calls. Used by `start.sh` boot gating.
- `GET /api/healthz/ready` — readiness probe. Calls `ee.Number(1).getInfo()` to verify Earth Engine is reachable. Returns `503` + `degraded` if GEE fails (which is fine and expected when `NETINSPECT_SKIP_EE_INIT=1`).

```bash
curl http://127.0.0.1:5050/api/healthz          # direct
curl http://127.0.0.1:3666/api/healthz          # via Next.js rewrite (proves the wiring)
curl http://127.0.0.1:5050/api/healthz/ready    # GEE check
```

## API surface

Read endpoints (no GEE required, served from `local_data.py`):

| Endpoint | Returns |
|---|---|
| `GET /api/regions` | List of 17 region names (Ghana + 16 administrative regions) |
| `GET /api/regions/details` | Per-region road km, edge count, class composition (multi-second cold call — used by `/regions` page only, NOT by the workbench load gate) |
| `GET /api/class_palette` | `{order: [...], colors: {fclass: hex}}` — sub-millisecond, no shapefile load. Used by the workbench to gate map mount. |
| `GET /api/region_info?region=` | `{center: [lat, lng]}` |
| `GET /api/boundary_layer?region=` | GeoJSON polygon (convex hull of region's roads) |
| `GET /api/exports` | List of past extractions in `NETINSPECT_OUTPUT_DIR`, grouped by prefix |
| `GET /api/exports/file/<name>` | Download a single export file (path-safe via `secure_filename`) |

The road geometries themselves are NOT served from a JSON endpoint. They live in a single ~24 MB `frontend/public/tiles/ghana_roads.pmtiles` file built once via `python scripts/build_tiles.py`, served as a static file with HTTP byte-range support, and rendered by MapLibre GL JS via the `pmtiles://` protocol. See the "Rebuilding tiles" section below.

Write endpoints (still GEE-bound for the Sentinel-2 part):

| Endpoint | Returns |
|---|---|
| `POST /api/export_polygon_network_s2` | Pulls drivable network via osmnx + Sentinel-2 mean indices via Earth Engine. Writes 3 files to `OUTPUT_DIR`. |
| `GET /api/road_stats` | Per-road click-to-query stats (legacy, still GEE-bound, not used by the new workbench) |
| `GET /api/random_road_stats` | Random road sample stats (legacy) |

## Rebuilding tiles

The `ghana_roads.pmtiles` file is committed to git. Rebuild it manually after the source shapefile (`data/gis_osm_roads_free_1.shp`) updates:

```bash
brew install tippecanoe        # one-time, macOS (or apt install tippecanoe on Ubuntu 24.04+)
python scripts/build_tiles.py  # ~30 seconds, idempotent (skips if output is newer than input)
git add frontend/public/tiles/ghana_roads.pmtiles
git commit -m "data: rebuild ghana_roads.pmtiles"
```

The build is NOT wired into `setup.sh` or CI — fresh checkouts get the committed file directly. Tippecanoe is only required for the rebuild itself.

## Known TODOs

See [`TODOS.md`](TODOS.md) for the explicitly-deferred work — auth, Docker, production deploy, async job queue, the Sentinel-2 part of the export endpoint, true admin region polygons.

## Acknowledgements

Imperial College London Transport Systems & Logistics Laboratory (TSL). Powered by Google Earth Engine, OpenStreetMap (via Geofabrik), and the European Space Agency Copernicus programme.
