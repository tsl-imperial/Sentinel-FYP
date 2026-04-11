# Network Inspector — frontend

Next.js 16 App Router + TypeScript + Tailwind. Mirrors the metis house style.
This README is the contractor onboarding doc; for the project-wide picture see
the [top-level README](../README.md).

## Run it

The frontend assumes the Flask backend is reachable at `FLASK_BACKEND_URL`
(default `http://127.0.0.1:5050`). For the full stack, use the **top-level**
`./start.sh` — it boots Flask in the background, polls `/api/healthz` until
Flask responds, starts Next.js in the background, and exits. Both services
keep running after the script returns. Don't run `npm run dev` here unless
Flask is already running elsewhere.

```bash
cd ..                     # back to repo root
./start.sh                # backgrounds Flask + Next.js, exits in ~15s
./start.sh logs next      # tail just the Next.js log (great for hot-reload watching)
./start.sh stop           # done
```

Frontend-only commands (run from this directory):

```bash
npm run dev          # next dev (assumes Flask is running on FLASK_BACKEND_URL)
npm run build        # production build, prerenders all 7 routes
npm run start        # serve the built app
npm run typecheck    # tsc --noEmit, strict + noUncheckedIndexedAccess
npm run lint         # eslint flat config (typescript-eslint)
npm run test         # vitest unit tests
npm run test:watch   # vitest watch mode
npm run test:e2e     # playwright (full stack must be running)
```

## How the routing works

```
app/
├── layout.tsx          ← root layout, Tailwind, Providers wrapper, maplibre-gl CSS import
├── providers.tsx       ← TanStack Query client (5min default staleTime)
├── globals.css         ← Tailwind directives + a few utilities
├── page.tsx            ← redirects / → /workbench
├── workbench/
│   └── page.tsx        ← main map UI (composition root)
├── regions/
│   └── page.tsx        ← region browser
├── exports/
│   └── page.tsx        ← export history
├── about/
│   └── page.tsx        ← static methodology page
├── components/         ← shared React components (MapView, ClassLayerLegend, ...)
├── hooks/              ← TanStack Query wrappers (useClassPalette, useRegionInfo, ...) + usePolygonDraw
└── lib/
    ├── api.ts             ← typed fetch wrapper (apiFetch + ApiError)
    ├── format.ts          ← Intl-based formatBytes / formatDate
    ├── maplibre.ts        ← pmtiles protocol registration (idempotent, side-effect import)
    ├── maplibre-style.ts  ← buildRoadStyle(palette) — pure function, returns MapLibre style spec
    ├── timePoints.ts      ← 24-quarter time-slider data
    ├── summarize.ts       ← ResultStatus → user message
    └── schemas/           ← one Zod schema per /api/* endpoint

public/
└── tiles/
    └── ghana_roads.pmtiles  ← ~24 MB committed binary, served as pmtiles:// via Next.js static handler
```

App Router file conventions: `app/foo/page.tsx` is `/foo`. Add a directory,
add a `page.tsx`, you have a new route. The Nav (`app/components/Nav.tsx`) is
the only place that lists the routes for the top nav bar — add to that array
when you add a public-facing page.

## How to add a new `/api/*` endpoint

This is the most common contractor task. Follow it strictly — the existing
endpoints all match this shape and review will catch deviations.

1. **Backend** — add the Flask handler in `backend/app.py`. Read from
   `backend/local_data.py` if possible. Return `jsonify({...})` with a
   stable shape. If you call Earth Engine, the `EEException` errorhandler
   already converts failures to `503 + earth_engine_unavailable`.

2. **Schema** — add a Zod schema in `app/lib/schemas/<endpoint>.ts`. Reuse
   the GeoJSON primitives from `app/lib/schemas/geojson.ts` if your response
   contains geometries.

3. **Hook** — add a one-line wrapper around `useApiQuery` in `app/hooks/`.
   Don't hand-roll a `useQuery` call. Example:
   ```typescript
   import { useApiQuery } from './useApiQuery';
   import { mySchema, type MyData } from '@/lib/schemas/my';

   export function useMyData(arg: string | null) {
     return useApiQuery<MyData, string | null>(
       'my_data',
       arg,
       (a) => `/api/my?arg=${encodeURIComponent(a!)}`,
       mySchema,
       { enabled: !!arg },
     );
   }
   ```

4. **Use it** — call the hook from a `'use client'` page or component. The
   hook returns `{data, isLoading, error}` — render the loading/error/empty
   states with `<StatusCard kind="loading|error|empty">`.

5. **Test it** — add a happy-path pytest in `tests/test_app.py`. The
   `mocked_ee` fixture replaces GEE so tests don't need real credentials.

## How to add a new page

1. Create `app/<route>/page.tsx`. Mark it `'use client'` if it uses hooks
   (data fetching or state).
2. Wrap the body in `<PageHeader title={...} />` followed by a `<main>` that
   matches the existing layout (`mx-auto max-w-[1600px] px-8 py-6`).
3. Add the route to the `ITEMS` array in `app/components/Nav.tsx`.
4. If the page reads URL search params, wrap the body in a `<Suspense>` —
   App Router requires this. See `app/workbench/page.tsx` for the pattern.

## Critical gotchas

These are the things that will burn you if you don't know about them. Each
one is locked by a regression test or a load-bearing comment in the source.

### MapLibre + react-map-gl + pmtiles

MapLibre GL JS touches `window` at module load and crashes Next.js SSR/SSG.

- **`MapView` MUST be loaded via `next/dynamic({ ssr: false })`.** See
  `app/workbench/page.tsx` for the pattern.
- **`app/lib/maplibre.ts` registers the `pmtiles://` protocol with MapLibre at module
  import time.** It's idempotent (HMR-safe). The `MapView` component imports it
  for the side effect — do not move that import or the protocol won't be
  registered when the map mounts and the road tiles will fail to load.
- The MapLibre CSS is imported from `app/layout.tsx` (not from
  `app/lib/maplibre.ts`). Side-effect CSS imports inside dynamic-import chains
  don't reliably make it into the page's CSS chunk in Next.js App Router —
  putting it at the root guarantees it's bundled.

### terra-draw + style-loaded gating

`terra-draw`'s `start()` requires the MapLibre style to be fully loaded. If
you call it during the brief window where the basemap raster + pmtiles vector
source are still streaming, it throws **"Style is not done loading."**
`app/hooks/usePolygonDraw.ts` gates initialization on `map.isStyleLoaded()`
(and waits for the `'load'` event otherwise) before calling `start()`. R7
(in `app/hooks/usePolygonDraw.test.ts`) asserts the cleanup detaches both
`change` and `finish` listeners AND calls `draw.stop()` — calling `stop()`
alone is not proof of cleanup if you also subscribed to events.

### React 19 strict mode

In dev, React 19 double-mounts effects to surface cleanup bugs. With
`react-map-gl/maplibre`, the cleanup contract for the MapLibre map instance
itself is library-owned: the wrapper disposes the underlying `map.remove()`
on component unmount. R5/R6 in `app/components/MapView.test.tsx` are smoke
tests that assert mounting under `<StrictMode>` doesn't throw — they no
longer manually verify `map.remove()` was called because that's the
library's job.

For `usePolygonDraw`, we still own the listener subscription, so R7 still
asserts the cleanup. Don't delete or skip these tests.

### `next.config.js` rewrites

The `/api/*` rewrite to Flask is the load-bearing wire between the two
processes. `next.config.js` reads the top-level `.env` via `dotenv` so the
backend URL stays in sync with whatever Flask uses. There is **NO** local
`.env` inside this directory — the top-level one is the single source of
truth.

`127.0.0.1` (not `localhost`) everywhere — macOS resolves `localhost` to both
`::1` and `127.0.0.1`, and Node's HTTP client picks IPv6 first while Flask
binds IPv4. Mismatch = silent failure.

### Default ports are 5050 / 3666, not 5000 / 3000

- Flask is on **5050** because macOS Control Center / AirPlay Receiver
  permanently binds 5000.
- Next.js is on **3666** to mirror metis and to dodge the common 3000
  conflict with other Node dev servers.

Both overridable via `.env` (`FLASK_RUN_PORT`, `NEXT_PORT`).

### bash 3.2 compatibility

`setup.sh` and the top-level `start.sh` are bash 3.2 compatible because that
ships with macOS. Don't use `wait -n`, mapfile, associative arrays, or
`${var^^}` style transformations in those scripts. `start.sh` runs services
in the background and tracks them via `lsof` on the configured ports — there
is no parent process waiting for child exits, so `wait -n` would not have
helped anyway.

### CSS

MapLibre's CSS is imported from `app/layout.tsx`, NOT from `app/lib/maplibre.ts`.
Side-effect CSS imports inside dynamic-import chains don't reliably make it
into the page's CSS chunk in Next.js App Router — putting it at the root
guarantees it's bundled.

## Tests

```
app/components/Footer.test.tsx        smoke test (RTL + jsdom wiring)
app/components/MapView.test.tsx       R5 + R6 (StrictMode mount/unmount no-throw)
app/hooks/usePolygonDraw.test.ts      R7 (terra-draw off + stop both called on unmount)
app/lib/maplibre-style.test.ts        buildRoadStyle pure-function unit tests
app/lib/maplibre.test.ts              pmtiles protocol registration is idempotent
tests/setup.ts                        @testing-library/jest-dom
tests/e2e/rewrite-smoke.spec.ts       Playwright: hits /api/healthz via Next port,
                                      proves the rewrite is wired
```

To add a unit test, drop `<Component>.test.tsx` next to the component. Vitest
auto-discovers it. To add an E2E test, drop a `.spec.ts` in `tests/e2e/`.

## Conventions worth following

- **'use client' at the top of any file that uses hooks.** Server components
  don't need it. The page files for `/regions`, `/exports`, `/workbench` are
  all client because they use TanStack Query; `/about` is a server component.
- **Reach for the existing `app/components/SummaryStrip` and
  `app/components/StatusCard`** before writing new loading/error/empty
  shells. Both `/regions` and `/exports` use them.
- **Don't hand-write a TanStack Query hook** — always go through
  `useApiQuery`. The factory enforces consistent staleTime, retry, and key
  shapes; review will catch drift.
- **Don't hand-write color constants** — the road class palette is served by
  the lightweight `/api/class_palette` endpoint and consumed via
  `useClassPalette()`. Front-end has zero copies. Do NOT switch the palette
  source to `/api/regions/details` — that triggers `region_summaries()` which
  is multi-second cold and would gate the workbench load on a slow path.
- **Don't add a second `.env` file** in this directory. The top-level `.env`
  is the single source of truth for both Flask and Next.js. `next.config.js`
  reads it via `dotenv` with an explicit relative path.

## Where to look when something's broken

| Symptom | Likely cause | First place to look |
|---|---|---|
| Map renders as an empty white box | MapLibre CSS not bundled | `app/layout.tsx` should `import 'maplibre-gl/dist/maplibre-gl.css'` |
| Map shows basemap but no road overlay | `.pmtiles` file missing or 404 | `curl -I http://127.0.0.1:3666/tiles/ghana_roads.pmtiles` — should be 200; rebuild via `python scripts/build_tiles.py` |
| Tiles fetch but render as `0/0/0` blank | Range requests not honored on the static handler | `curl -H "Range: bytes=0-127" http://127.0.0.1:3666/tiles/ghana_roads.pmtiles` — should be 206 with `Accept-Ranges: bytes` |
| "Style is not done loading" runtime error | terra-draw `start()` called before MapLibre style is ready | `app/hooks/usePolygonDraw.ts` should gate on `map.isStyleLoaded()` and wait for `'load'` otherwise |
| Map mounts but workbench shows "Loading map…" forever | `/api/class_palette` returning 404 (Flask not restarted after backend changes) or 5xx | `curl http://127.0.0.1:5050/api/class_palette` directly; if 404 the Flask process predates the new route |
| All `/api/*` calls return CORS errors | Flask not running, or wrong port | `curl http://127.0.0.1:5050/api/healthz` directly |
| "Failed to load regions" / 503 from `/api/regions` | Earth Engine not authenticated AND `NETINSPECT_SKIP_EE_INIT` not set | Add `NETINSPECT_SKIP_EE_INIT=1` to `.env` |
| `npm run build` fails with "window is not defined" | Top-level MapLibre import in a non-dynamic module | The component must be loaded via `next/dynamic({ ssr: false })` |
| HMR WebSocket connection failed | Next.js 16 `allowedDevOrigins` not whitelisting your origin | `next.config.js` `allowedDevOrigins` array |
| Workbench doesn't preselect region from `/regions` click | `useSearchParams` not wrapped in Suspense | `app/workbench/page.tsx` should export a `<Suspense>` boundary |
| Region picker change doesn't move the map | `flyTo` `useEffect` not watching center/zoom, or `mapRef` not held in state | `app/workbench/page.tsx` — `useEffect([mapRef, center, zoom])` calls `mapRef.getMap().flyTo(...)` |
