# Network Inspector — frontend

Next.js 16 App Router + TypeScript + Tailwind. Mirrors the metis house style.
This README is the contractor onboarding doc; for the project-wide picture see
the [top-level README](../../../README.md).

## Run it

The frontend assumes the Flask backend is reachable at `FLASK_BACKEND_URL`
(default `http://127.0.0.1:5050`). For the full stack, use the **top-level**
`./start.sh` — it boots Flask, polls `/api/healthz` until Flask is ready, then
starts Next.js. Don't run `npm run dev` here unless Flask is already running
elsewhere.

```bash
cd ../../..               # back to repo root
./start.sh                # boots Flask + Next.js together
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
├── layout.tsx          ← root layout, Tailwind, Providers wrapper
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
├── components/         ← shared React components
├── hooks/              ← TanStack Query wrappers + usePolygonDraw
└── lib/
    ├── api.ts          ← typed fetch wrapper (apiFetch + ApiError)
    ├── format.ts       ← Intl-based formatBytes / formatDate
    ├── leaflet.ts      ← createMap helper, basemap config
    ├── timePoints.ts   ← 24-quarter time-slider data
    ├── summarize.ts    ← ResultStatus → user message
    └── schemas/        ← one Zod schema per /api/* endpoint
```

App Router file conventions: `app/foo/page.tsx` is `/foo`. Add a directory,
add a `page.tsx`, you have a new route. The Nav (`app/components/Nav.tsx`) is
the only place that lists the routes for the top nav bar — add to that array
when you add a public-facing page.

## How to add a new `/api/*` endpoint

This is the most common contractor task. Follow it strictly — the existing
endpoints all match this shape and review will catch deviations.

1. **Backend** — add the Flask handler in `application/web/app.py`. Read from
   `application/web/local_data.py` if possible. Return `jsonify({...})` with a
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

### Leaflet imports

Leaflet touches `window` at module load and crashes Next.js SSR/SSG.
Two consequences:

- **`MapView` MUST be loaded via `next/dynamic({ ssr: false })`.** See
  `app/workbench/page.tsx` for the pattern.
- **Inside `usePolygonDraw`**, Leaflet is required lazily inside the
  `useEffect` (not imported at the top of the file), because the hook is
  imported by `workbench/page.tsx` directly and the SSR shell pass would
  evaluate the module body otherwise. The `// eslint-disable-next-line` for
  `no-require-imports` is there for that reason — leave it.

### React 19 strict mode

In dev, React 19 double-mounts effects to surface cleanup bugs. This is the
reason for **regression tests R5/R6/R7** in `app/components/MapView.test.tsx`
and `app/hooks/usePolygonDraw.test.ts`:

- Every Leaflet map / layer / event listener you add to a `useEffect` MUST be
  removed in the cleanup function. Otherwise you leak Leaflet objects across
  region switches and get "Map container is already initialized" errors.
- The mandatory regression tests fail loudly if cleanup is missing. Don't
  delete or skip them.

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
`${var^^}` style transformations in those scripts. The `start.sh` uses a
`while kill -0` polling loop instead of `wait -n` for exactly this reason.

### CSS

Leaflet's CSS is imported from `app/layout.tsx`, NOT from `app/lib/leaflet.ts`.
Side-effect CSS imports inside dynamic-import chains don't reliably make it
into the page's CSS chunk in Next.js App Router — putting it at the root
guarantees it's bundled.

## Tests

```
app/components/Footer.test.tsx        smoke test (RTL + jsdom wiring)
app/components/MapView.test.tsx       R5 + R6 (unmount cleanup, strict-mode safety)
app/hooks/usePolygonDraw.test.ts      R7 (event listener cleanup)
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
  `/api/regions/details` (`class_palette.colors`) and `/api/overview_layers`
  (per-layer `color`). Front-end has zero copies.
- **Don't add a second `.env` file** in this directory. The top-level `.env`
  is the single source of truth for both Flask and Next.js. `next.config.js`
  reads it via `dotenv` with an explicit relative path.

## Where to look when something's broken

| Symptom | Likely cause | First place to look |
|---|---|---|
| Map renders as an empty white box | Leaflet CSS not bundled | `app/layout.tsx` should `import 'leaflet/dist/leaflet.css'` |
| "Map container is already initialized" | useEffect cleanup missing in Leaflet code | The effect that called `L.map(...)` — must `return () => map.remove()` |
| All `/api/*` calls return CORS errors | Flask not running, or wrong port | `curl http://127.0.0.1:5050/api/healthz` directly |
| "Failed to load regions" / 503 from `/api/regions` | Earth Engine not authenticated AND `NETINSPECT_SKIP_EE_INIT` not set | Add `NETINSPECT_SKIP_EE_INIT=1` to `.env` |
| `npm run build` fails with "window is not defined" | Top-level Leaflet import in a non-dynamic module | Move the import inside `useEffect` as `require('leaflet')` |
| HMR WebSocket connection failed | Next.js 16 `allowedDevOrigins` not whitelisting your origin | `next.config.js` `allowedDevOrigins` array |
| Workbench doesn't preselect region from `/regions` click | `useSearchParams` not wrapped in Suspense | `app/workbench/page.tsx` should export a `<Suspense>` boundary |
