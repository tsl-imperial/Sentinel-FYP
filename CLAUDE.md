# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo vs product name

The GitHub repo is `tsl-imperial/Sentinel-FYP` for historical reasons. The product is **Network Inspector**. All internal naming uses `NETINSPECT_*` env vars and `network-inspector-*` package names. Do not reintroduce `SENTINEL_*` env var names or `sentinel-fyp-*` package names — that was the pre-v2 convention.

## Architecture (the load-bearing thing)

Two processes orchestrated by a single `./start.sh`:

```
Browser → Next.js (Node, 3666) → /api/* rewrite → Flask (Python, 5050)
                                                          │
                                       ┌──────────────────┼──────────────────┐
                                       ▼                  ▼                  ▼
                              local_data.py            osmnx           earthengine-api
                              (parquet+SHP)           (live OSM)         (optional)
```

The browser only ever talks to Next.js. `next.config.js` rewrites `/api/*` to Flask, so it's same-origin from the browser's perspective and there's no CORS in normal use. CORS in `app.py` is gated on `NETINSPECT_DEV=1` and only exists as a fallback for tools that bypass the rewrite (Playwright direct fetches, manual `curl` against port 5050).

**The five read endpoints serve from `application/web/local_data.py`** (the Geofabrik OSM shapefile + the per-road Sentinel-2 parquet + the region lookup CSV). They run with **zero Earth Engine dependency**. Earth Engine is only required for the live `POST /api/export_polygon_network_s2` Sentinel-2 reduction step — and even that gracefully degrades to 503 with a `earth_engine_unavailable` payload via the `@app.errorhandler(EEException)` if GEE isn't authenticated.

**The backend stays Flask.** Do not propose moving `/api/*` routes into Next.js API routes. The data layer is `geopandas`, `osmnx`, `igraph`, and `earthengine-api` — all Python-only with no Node equivalents. This is a hard constraint, not a preference.

The frontend mirrors the `metis` project (a sibling repo at `../metis/`) at the framework level: Next.js 16 App Router + TypeScript + Tailwind, single `server/` directory, same-origin fetch with relative `/api/*` URLs. When in doubt about a frontend convention, look at metis first.

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
cd application/web/server
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
`application/web/app.py` calls `init_ee()` at module import. On any machine without Earth Engine credentials (CI, fresh checkout, pytest), this throws and the entire app fails to import. The guard is:

```python
if not os.environ.get("NETINSPECT_SKIP_EE_INIT"):
    init_ee()
```

`tests/conftest.py` sets `NETINSPECT_SKIP_EE_INIT=1` *before* importing the app module. CI sets it as a job env var. The default `.env.example` template also sets it to `1` so fresh checkouts boot cleanly. Comment the line in your local `.env` once you've run `earthengine authenticate`.

### `OUTPUT_DIR` is anchored to `__file__`, not CWD
The actual resolution lives in `application/web/local_data.py:output_dir()` (a function, not a constant — pytest reloads `application.web.app` to test env-var overrides, and a module-level cache would defeat that). `app.py` calls `local_data.output_dir()` once at import time. The function resolves `NETINSPECT_OUTPUT_DIR`:
- If absolute → use as-is
- If relative → resolve against `Path(__file__).resolve().parents[2]` (the repo root), NOT the current working directory
- If unset → default to `<repo>/outputs`

This was a regression fix — the previous version had a hardcoded `/Users/miranda/Documents/...` path. Tests R1-R4 in `tests/test_app.py` lock this behavior. **Do not "simplify" the resolution to `Path(value).resolve()`** — that resolves against CWD and silently breaks when Flask is invoked from a subdirectory. **Do not turn `output_dir()` back into a module-level constant** — the regression tests rely on it being re-callable.

### Single source of truth for `.env`
There is exactly **one** `.env` file at the repo root. `application/web/server/next.config.js` reads it via `dotenv` with an explicit path:

```js
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
```

Do not commit a second `.env.example` inside `application/web/server/`. The drift risk between two .env files is real (caught by outside-voice review during the v2 plan).

### React 19 strict mode + Leaflet
Leaflet uses `window` at module load and crashes Next.js SSR. Any component that imports Leaflet must be loaded via `next/dynamic` with `{ ssr: false }`:

```typescript
import dynamic from 'next/dynamic';
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });
```

React 19 strict mode double-mounts effects in dev. Calling `L.map(container)` twice on the same DOM node throws "Map container is already initialized." Every Leaflet `useEffect` MUST return a cleanup that calls `map.remove()`. Mandatory regression tests R5/R6/R7 lock this.

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
├── application/
│   ├── config.py                # env-driven constants (CLASS_COLORS, TOP10, EE_PROJECT)
│   ├── logic/                   # legacy GEE + geospatial logic (still used by export endpoint)
│   │   ├── gee.py
│   │   └── features.py
│   └── web/
│       ├── app.py               # Flask API (/api/* routes)
│       ├── local_data.py        # parquet + shapefile reader, served by /api/* read paths
│       └── server/              # Next.js 16 App Router frontend
│           ├── next.config.js   # /api/* rewrite to Flask, dotenv-loaded
│           ├── app/
│           │   ├── workbench/   # main map UI
│           │   ├── regions/     # region browser (uses /api/regions/details)
│           │   ├── exports/     # export history (uses /api/exports)
│           │   ├── about/       # static methodology
│           │   ├── components/  # Nav, MapView, ResultsPanel, SummaryStrip, StatusCard, ...
│           │   ├── hooks/       # useApiQuery factory + 5 endpoint wrappers + usePolygonDraw
│           │   └── lib/         # api.ts, format.ts, leaflet.ts, schemas/
│           └── tests/           # vitest unit + Playwright E2E
├── tests/                       # pytest backend suite (R1-R4 regressions + happy paths)
├── notebooks/                   # standalone Jupyter analysis (NOT part of the web app)
├── data/                        # OSM shapefile + parquet + region lookup (see README data sources)
└── outputs/                     # extraction outputs (gitignored)
```

`notebooks/` and `data/` exist for analyst workflows separate from the web app. Don't import from `notebooks/`. The web app DOES read from `data/` via `local_data.py` — do not move those files without updating the loader.

The legacy vanilla JS frontend (`application/web/static/` and `templates/`) was deleted at the end of Phase 2. The new frontend lives entirely in `application/web/server/`.

## `local_data.py` is load-bearing

`application/web/local_data.py` is the single point of contact between the Flask handlers and the local data files. Read it before adding any new endpoint. Conventions:

- Every loader is `@functools.lru_cache(maxsize=1)` and reads its data once on first call. Memory cost is bounded but real (~800 MB resident after warm-up).
- Every public function that returns user-visible data is also `@lru_cache`d, keyed on its arguments. Cold calls are 1-3 seconds; warm calls are microseconds.
- The road class palette is defined in `application/config.py:CLASS_COLORS`. `local_data.class_palette()` exposes it via `/api/regions/details` so the frontend has zero copies.
- `output_dir()` is a function, not a constant (see the OUTPUT_DIR gotcha above).
- If you add new fields to `region_summaries()` or similar, also add them to the matching Zod schema in `application/web/server/app/lib/schemas/`.

## Mandatory regression tests (Iron Rule)

Seven tests that must remain green at all times. They lock load-bearing fixes against silent regression:

- **R1-R4** (backend, `tests/test_app.py`) — `OUTPUT_DIR` resolution is repo-root-anchored, env-overridable, and never CWD-relative
- **R5-R6** (frontend, `app/components/MapView.test.tsx`) — `MapView` unmount calls `map.remove()`; mounting under `<StrictMode>` doesn't throw "Map container is already initialized"
- **R7** (frontend, `app/hooks/usePolygonDraw.test.ts`) — `usePolygonDraw` cleanup detaches all map event listeners

If you're ever tempted to delete or skip one of these, find the regression note in the plan file (`~/.claude/plans/cached-discovering-beaver.md`) first and understand why it exists.

## Out of scope (deferred)

See `TODOS.md` for the full deferred list with rationale. Short version:

- **Sentinel-2 reduction in the export endpoint** — still GEE-bound. `local_data.indices_for_polygon()` exists but isn't wired to the export route yet.
- **True admin region polygons** — `boundary_geojson_for_region` returns a convex hull, `area_km2` is bounding-box area.
- **Auth** — wait for World Bank to specify the IdP. Don't pre-build NextAuth.
- **Docker / production deployment** — depends on the deploy target.
- **Async job queue** — current synchronous model + AbortController is acceptable until response times become a real blocker.
- **Database** — single-server filesystem is fine for now.
- **Backend refactor of `application/logic/`** — works as-is, leave alone.

If you find yourself about to add any of the above, stop and check `TODOS.md` first.

## Reference docs

- The full v2 modernization plan (with all decisions and reviews) lives at `~/.claude/plans/cached-discovering-beaver.md`. This is the source of truth for "why is it like this."
- Visual mockups for the new frontend are at `~/.gstack/projects/tsl-imperial-Sentinel-FYP/mockups/` (workbench, regions, about — light-themed Tailwind, Network Inspector branding).
- The companion project for frontend conventions is `../metis/` (also yours). When choosing a Next.js pattern, check what metis does first.
