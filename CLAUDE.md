# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo vs product name

The GitHub repo is `tsl-imperial/Sentinel-FYP` for historical reasons. The product is **Network Inspector**. All internal naming uses `NETINSPECT_*` env vars and `network-inspector-*` package names. Do not reintroduce `SENTINEL_*` env var names or `sentinel-fyp-*` package names — that was the pre-v2 convention.

## Architecture (the load-bearing thing)

Two processes orchestrated by a single `./start.sh`:

```
Browser → Next.js (Node, 3666) → /api/* rewrite → Flask (Python, 5050)
   │                                                       │
   │ pmtiles:// range reads to                             │
   │ /tiles/ghana_roads.pmtiles  (static, in public/)      │
   │                                       ┌───────────────┼───────────────┐
   │                                       ▼               ▼               ▼
   ▼                              local_data.py        osmnx        earthengine-api
MapLibre GL + WebGL              (parquet+SHP)       (live OSM)       (optional)
(react-map-gl, terra-draw)
```

The browser only ever talks to Next.js. `next.config.js` rewrites `/api/*` to Flask, so it's same-origin from the browser's perspective and there's no CORS in normal use. CORS in `app.py` is gated on `NETINSPECT_DEV=1` and only exists as a fallback for tools that bypass the rewrite (Playwright direct fetches, manual `curl` against port 5050).

**The map renderer is MapLibre GL JS via `react-map-gl/maplibre`**, with vector road tiles served as a single `.pmtiles` file from `frontend/public/tiles/`. The browser does HTTP byte-range reads against the pmtiles file (Next.js's static handler returns 206 with `Accept-Ranges`/`Content-Range`, verified for both `next dev` and `next start`). Polygon drawing is `terra-draw` + the MapLibre adapter, hand-rolled UX is gone.

**The read endpoints serve from `backend/local_data.py`** (the Geofabrik OSM shapefile + the per-road Sentinel-2 parquet + the region lookup CSV). They run with **zero Earth Engine dependency**. Earth Engine is only required for the live `POST /api/export_polygon_network_s2` Sentinel-2 reduction step — and even that gracefully degrades to 503 with a `earth_engine_unavailable` payload via the `@app.errorhandler(EEException)` if GEE isn't authenticated.

**The backend stays Flask.** Do not propose moving `/api/*` routes into Next.js API routes. The data layer is `geopandas`, `osmnx`, `igraph`, and `earthengine-api` — all Python-only with no Node equivalents. This is a hard constraint, not a preference.

The frontend mirrors the `metis` project (a sibling repo at `../metis/`) at the framework level: Next.js 16 App Router + TypeScript + Tailwind, same-origin fetch with relative `/api/*` URLs. (metis calls its frontend dir `server/`; ours is just `frontend/` because the actual API server is Flask, and naming a frontend `server` was confusing.) When in doubt about a frontend convention, look at metis first.

## Common commands

```bash
# One-time bootstrap (creates .venv, installs Python + Node deps, copies .env)
./setup.sh

# Run the full dev stack (Flask + Next.js, with health gating)
./start.sh

# Backend tests
source .venv/bin/activate
NETINSPECT_SKIP_EE_INIT=1 pytest -v
NETINSPECT_SKIP_EE_INIT=1 pytest tests/test_app.py::test_healthz_returns_ok -v   # single test

# Frontend
cd frontend
npm run dev          # Next.js only (assumes Flask running separately)
npm run build        # production build (also runs typecheck)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint flat config (typescript-eslint)
npm run test         # vitest unit tests, includes R5/R6/R7 regressions
npm run test:watch   # vitest in watch mode
npm run test:e2e     # Playwright (requires ./start.sh running in another terminal)

# Health checks once stack is up
curl http://127.0.0.1:5050/api/healthz          # direct (Flask)
curl http://127.0.0.1:3666/api/healthz          # via Next rewrite — proves the wiring
curl http://127.0.0.1:5050/api/healthz/ready    # GEE readiness
```

## Critical gotchas

### `init_ee()` is gated on `NETINSPECT_SKIP_EE_INIT`
`backend/app.py` calls `init_ee()` at module import. On any machine without Earth Engine credentials (CI, fresh checkout, pytest), this throws and the entire app fails to import. The guard is:

```python
if not os.environ.get("NETINSPECT_SKIP_EE_INIT"):
    init_ee()
```

`tests/conftest.py` sets `NETINSPECT_SKIP_EE_INIT=1` *before* importing the app module. CI sets it as a job env var. The default `.env.example` template also sets it to `1` so fresh checkouts boot cleanly. Comment the line in your local `.env` once you've run `earthengine authenticate`.

### `OUTPUT_DIR` is anchored to `__file__`, not CWD
The actual resolution lives in `backend/local_data.py:output_dir()` (a function, not a constant — pytest reloads `backend.app` to test env-var overrides, and a module-level cache would defeat that). `app.py` calls `local_data.output_dir()` once at import time. The function resolves `NETINSPECT_OUTPUT_DIR`:
- If absolute → use as-is
- If relative → resolve against `Path(__file__).resolve().parents[1]` (the repo root, since `backend/` is a top-level package), NOT the current working directory
- If unset → default to `<repo>/outputs`

This was a regression fix — the previous version had a hardcoded `/Users/miranda/Documents/...` path. Tests R1-R4 in `tests/test_app.py` lock this behavior. **Do not "simplify" the resolution to `Path(value).resolve()`** — that resolves against CWD and silently breaks when Flask is invoked from a subdirectory. **Do not turn `output_dir()` back into a module-level constant** — the regression tests rely on it being re-callable.

### Single source of truth for `.env`
There is exactly **one** `.env` file at the repo root. `frontend/next.config.js` reads it via `dotenv` with an explicit path:

```js
require('dotenv').config({ path: path.join(__dirname, '../.env') });
```

Do not commit a second `.env.example` inside `frontend/`. The drift risk between two .env files is real (caught by outside-voice review during the v2 plan).

### React 19 strict mode + MapLibre
MapLibre GL JS uses `window` at module load and crashes Next.js SSR. The `MapView` component must be loaded via `next/dynamic` with `{ ssr: false }`:

```typescript
import dynamic from 'next/dynamic';
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });
```

`react-map-gl/maplibre` owns the cleanup contract for the MapLibre map instance — it disposes the underlying `map.remove()` on component unmount, and StrictMode double-mount is safe by default. We do NOT manually wire any `useEffect` that creates the map; that's the whole point of using the React wrapper. R5/R6 (in `app/components/MapView.test.tsx`) are smoke tests that assert the wrapper renders cleanly under StrictMode without throwing.

### terra-draw + style-loaded gating
`terra-draw`'s `start()` requires the MapLibre style to be fully loaded. If you call it during the brief window where the basemap raster + pmtiles vector source are still streaming, it throws **"Style is not done loading"**. `usePolygonDraw` gates initialization on `map.isStyleLoaded()` (and waits for the `'load'` event otherwise) before calling `start()`. R7 (in `app/hooks/usePolygonDraw.test.ts`) asserts both `draw.off('change'/'finish')` AND `draw.stop()` are called on cleanup — calling `stop()` alone is not proof of cleanup if you also subscribed to events.

### pmtiles protocol registration
The PMTiles JS library exposes a `Protocol` class that bridges `pmtiles://` URLs in the MapLibre style spec to HTTP byte-range reads against a static file. We register it globally in `app/lib/maplibre.ts` with an idempotent guard so HMR re-imports are safe. The `MapView` imports `maplibre.ts` for the side effect — do not move that import or the protocol won't be registered when the map mounts.

### `/api/class_palette` is the lightweight palette endpoint
The workbench gates its `<MapView>` mount on `useClassPalette()` resolving (the MapLibre style spec needs the road class colors before it can be built). That endpoint is intentionally separate from `/api/regions/details` because the latter triggers `region_summaries()` which is documented as a multi-second cold call (TODOS.md). `/api/class_palette` reads only the dict literal from `backend/config.py:CLASS_COLORS` and is sub-millisecond cold and warm. **Never gate UI mounts on `/api/regions/details`.** Codex caught this during the rebuild plan review.

### Region picker is camera-only in the workbench
After the v2.5 map rebuild, the workbench loads the single Ghana `.pmtiles` containing all 95k+ road features. The region picker no longer filters which roads are visible — it calls `mapRef.flyTo({center, zoom, duration: 600})` to recenter the camera. ALL roads remain visible at all times. Side benefit: fixes a bug where panning past a region's convex hull produced an empty map. The `/regions` page still works as a per-region browser via the unchanged `/api/regions/details` endpoint.

### Vector tiles live in `public/tiles/` and are committed to git
`frontend/public/tiles/ghana_roads.pmtiles` is a ~24 MB binary built once via `python scripts/build_tiles.py` and committed to git (consistent with `data/`, which is also committed). Tippecanoe is NOT a `setup.sh` prerequisite — it's only needed when rebuilding the tile after a shapefile update. To rebuild: `brew install tippecanoe && python scripts/build_tiles.py && git add frontend/public/tiles/`.

### `next.config.js` rewrites use `127.0.0.1`, not `localhost`
Intentional. macOS resolves `localhost` to both `::1` and `127.0.0.1`, and Node's HTTP client picks IPv6 first. Flask binds IPv4 by default. Using `127.0.0.1` everywhere avoids the dual-stack mismatch.

### Default ports are 5050 and 3666, NOT 5000 and 3000
Flask defaults to **5050** because macOS Control Center / AirPlay Receiver permanently binds port 5000 — using 5000 produces a confusing "Address already in use" that the user often can't fix without disabling system features. Next.js defaults to **3666** to mirror the metis house style and to avoid the common 3000 conflict with other Node dev servers. Both are overridable via `.env` (`FLASK_RUN_PORT`, `NEXT_PORT`).

### `start.sh` is bash 3.2 compatible
macOS ships bash 3.2 by default. Do not use `wait -n`, mapfile, associative arrays, or `${var^^}` style transformations in `start.sh` or `setup.sh`. The current `start.sh` uses a `while kill -0` polling loop instead of `wait -n` to detect child process death. If you need bash 4+ features, either use `zsh` (which is the macOS default shell) or pin to `#!/usr/bin/env bash` and document the requirement.

## Repo layout

```
.
├── setup.sh / start.sh          # bootstrap + dev orchestrator (top-level)
├── .env.example                 # single source for both Flask and Next.js
├── requirements.txt             # Python deps (Flask, GEE, geopandas, osmnx, ...)
├── scripts/
│   └── build_tiles.py           # one-shot: shapefile → tippecanoe → ghana_roads.pmtiles
├── backend/                     # Python (Flask + data layer + GEE)
│   ├── __init__.py
│   ├── app.py                   # Flask API (/api/* routes)
│   ├── local_data.py            # parquet + shapefile reader, served by /api/* read paths
│   ├── config.py                # env-driven constants (CLASS_COLORS, TOP10, EE_PROJECT)
│   ├── gee.py                   # Earth Engine helpers (init, region geom, S2 composites)
│   └── features.py              # nearest-road + per-road S2 stats (only used by export route)
├── frontend/                    # Next.js 16 App Router
│   ├── next.config.js           # /api/* rewrite to Flask, dotenv-loaded from ../.env
│   ├── app/
│   │   ├── workbench/           # main map UI
│   │   ├── regions/             # region browser (uses /api/regions/details)
│   │   ├── exports/             # export history (uses /api/exports)
│   │   ├── about/               # static methodology
│   │   ├── components/          # Nav, MapView (react-map-gl), ResultsPanel, ...
│   │   ├── hooks/               # useApiQuery factory + endpoint wrappers + usePolygonDraw
│   │   └── lib/                 # api.ts, format.ts, maplibre.ts, maplibre-style.ts, schemas/
│   ├── public/
│   │   └── tiles/
│   │       └── ghana_roads.pmtiles  # ~24 MB committed binary, served as pmtiles://
│   └── tests/                   # vitest unit + Playwright E2E
├── tests/                       # pytest backend suite (R1-R4 regressions + happy paths)
├── notebooks/                   # standalone Jupyter analysis (NOT part of the web app)
├── data/                        # OSM shapefile + parquet + region lookup (see README data sources)
└── outputs/                     # extraction outputs (gitignored)
```

`notebooks/` and `data/` exist for analyst workflows separate from the web app. Don't import from `notebooks/`. The web app DOES read from `data/` via `backend/local_data.py` — do not move those files without updating the loader.

The legacy vanilla JS frontend (the old `application/web/static/` and `templates/` dirs) was deleted at the end of Phase 2. The new frontend lives entirely in `frontend/`. (For most of v2 it lived under `application/web/server/`; the v2.6 layout flatten moved it to `frontend/` and collapsed `application/` into `backend/` at the same time.)

## `local_data.py` is load-bearing

`backend/local_data.py` is the single point of contact between the Flask handlers and the local data files. Read it before adding any new endpoint. Conventions:

- Every loader is `@functools.lru_cache(maxsize=1)` and reads its data once on first call. Memory cost is bounded but real (~800 MB resident after warm-up).
- Every public function that returns user-visible data is also `@lru_cache`d, keyed on its arguments. Cold calls are 1-3 seconds; warm calls are microseconds.
- The road class palette is defined in `backend/config.py:CLASS_COLORS`. `local_data.class_palette()` exposes it via the lightweight `/api/class_palette` endpoint (sub-millisecond, no shapefile load) so the frontend has zero copies. Do NOT gate UI mounts on `/api/regions/details` — that triggers `region_summaries()` which is multi-second cold.
- `output_dir()` is a function, not a constant (see the OUTPUT_DIR gotcha above).
- If you add new fields to `region_summaries()` or similar, also add them to the matching Zod schema in `frontend/app/lib/schemas/`.

## Mandatory regression tests (Iron Rule)

Nine tests that must remain green at all times. They lock load-bearing fixes against silent regression:

- **R1-R4** (backend, `tests/test_app.py`) — `OUTPUT_DIR` resolution is repo-root-anchored, env-overridable, and never CWD-relative
- **R5-R6** (frontend, `app/components/MapView.test.tsx`) — `MapView` unmount calls `map.remove()`; mounting under `<StrictMode>` doesn't throw "Map container is already initialized"
- **R7** (frontend, `app/hooks/usePolygonDraw.test.ts`) — `usePolygonDraw` cleanup detaches all map event listeners
- **R8** (frontend, `app/components/ui/DockedPanel.test.tsx`) — `DockedPanel` mount/unmount under StrictMode without throwing; ESC keyboard listener is removed from `window` on unmount with the same handler reference. Added during the v2.5 nefos-primitives rebuild because the panel is the substrate for 3 mount sources (extraction / road inspector / welcome) and the ESC handler runs inside `useEffect`.
- **R9** (frontend, `app/hooks/useMapEvent.test.ts`) — `useMapEvent(map, event, handler)` calls `map.off(event, handler)` with the SAME handler reference passed to `map.on()` during cleanup. The 4 map instruments (`CompassRose`, `MapScaleBar`, the hover handler, and any future map subscribers) all funnel through this hook, so a leak in the contract cascades silently. Mirrors R7 structure exactly.

If you're ever tempted to delete or skip one of these, find the regression note in the plan file (`~/.claude/plans/cached-discovering-beaver.md` for R1-R7, `~/.gstack/projects/tsl-imperial-Sentinel-FYP/ceo-plans/2026-04-11-workbench-nefos-primitives.md` for R8/R9) first and understand why it exists.

## Out of scope (deferred)

See `TODOS.md` for the full deferred list with rationale. Short version:

- **Sentinel-2 reduction in the export endpoint** — still GEE-bound. `local_data.indices_for_polygon()` exists but isn't wired to the export route yet.
- **True admin region polygons** — `boundary_geojson_for_region` returns a convex hull, `area_km2` is bounding-box area.
- **Auth** — wait for World Bank to specify the IdP. Don't pre-build NextAuth.
- **Docker / production deployment** — depends on the deploy target.
- **Async job queue** — current synchronous model + AbortController is acceptable until response times become a real blocker.
- **Database** — single-server filesystem is fine for now.
- **Backend refactor of `backend/gee.py` + `backend/features.py`** — works as-is, leave alone. (These were `application/logic/gee.py` + `application/logic/features.py` before the v2.6 layout flatten.)

If you find yourself about to add any of the above, stop and check `TODOS.md` first.

## Reference docs

- The full v2 modernization plan (with all decisions and reviews) lives at `~/.claude/plans/cached-discovering-beaver.md`. This is the source of truth for "why is it like this."
- Visual mockups for the new frontend are at `~/.gstack/projects/tsl-imperial-Sentinel-FYP/mockups/` (workbench, regions, about — light-themed Tailwind, Network Inspector branding).
- The companion project for frontend conventions is `../metis/` (also yours). When choosing a Next.js pattern, check what metis does first.
