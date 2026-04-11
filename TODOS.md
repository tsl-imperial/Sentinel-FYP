# TODOs — Network Inspector

Living list of work that's been done since the v2 modernization started, work
that's explicitly deferred, and known limitations of the current build. The
original modernization plan with full reasoning lives at
`/Users/pa01/.claude/plans/cached-discovering-beaver.md`.

---

## ✓ Done in v2 (was in TODOs / scope of the plan)

- Frontend ported from vanilla JS + Flask templates → Next.js 16 App Router + TypeScript + Tailwind, mirroring the metis house style
- Backend hygiene: hardcoded `/Users/miranda/...` path replaced with repo-root-anchored `OUTPUT_DIR`, `init_ee()` guarded for tests/CI, dev CORS, `/api/healthz` + `/api/healthz/ready`
- Streamlit prototype (`application/prototype.py`) deleted
- Bootstrap scripts: `setup.sh` (venv + npm install + tool checks) and `start.sh` (orchestrates Flask + Next.js with health gating, bash 3.2 compatible)
- Test scaffolding: pytest with R1-R4 regression tests, vitest with R5-R7 React 19 strict-mode regressions, Playwright E2E smoke
- GitHub Actions CI workflow
- **Local-data path** (originally a deferred option, now the default): `application/web/local_data.py` reads the Geofabrik Ghana shapefile + per-road Sentinel-2 parquet + region lookup CSV. The five read endpoints (`/api/regions`, `/api/region_info`, `/api/overview_layers`, `/api/boundary_layer`, `/api/regions/details`) serve from local files with **zero Earth Engine dependency**. Fresh checkouts boot without GEE auth.
- `/regions` page: real per-region cards with road km, edge count, class composition bar — fed by `/api/regions/details`
- `/exports` page: lists past extraction runs in `NETINSPECT_OUTPUT_DIR`, grouped by prefix, with download links

---

## Still deferred — in rough order of likely priority

### 1. Sentinel-2 reduction in the export endpoint

**What:** `POST /api/export_polygon_network_s2` is the one workbench code path that still requires Earth Engine. The osmnx graph extraction works without GEE, but the Sentinel-2 mean indices over the polygon's road corridor still go through `reduceRegion.getInfo()`.

**Why deferred:** The local parquet only covers the road segments that were pre-computed. A fresh polygon outside the existing osm_id set has nothing to look up. We'd need either (a) an "if all polygon roads are in the parquet, use it; else fall back to GEE" branch, or (b) accept that fresh polygons need GEE auth.

**Where it slots in:** `application/web/app.py:export_polygon_network_s2`. `local_data.indices_for_polygon()` already exists and is wired — it just isn't called from the export route yet.

**Trigger to start:** When you actually need a fully GEE-free demo for the World Bank handoff. ~30 minutes of work.

---

### 2. True administrative region polygons

**What:** `/api/boundary_layer` currently returns the convex hull of the region's road geometries. It's a visual indicator, not a real admin polygon. Same for `area_km2` in `/api/regions/details` — currently uses the bounding box rectangle area, which over-estimates by 2-3x for compact regions like Greater Accra.

**Where it slots in:** Drop a Ghana ADM1 GeoPackage (e.g., from `humdata.org` or the World Bank's WBGAD dataset already referenced in `application/config.py:REGIONS_FC_ID`) into `data/`, add a loader to `local_data.py`, replace `boundary_geojson_for_region` and the `area_km2` computation.

**Trigger to start:** When a stakeholder notices that "Greater Accra: 9,126 km²" is wrong (the real number is ~3,245 km²), or when the boundary outline needs to look like Ghana's actual administrative borders rather than a convex hull.

---

### 3. Authentication

**What:** Wire up real user authentication. Probably OIDC against the World Bank's identity provider.

**Why deferred:** World Bank hasn't specified the IdP yet. Pre-building NextAuth or a custom OIDC scaffold against an unknown identity provider risks ripping it all out and starting over.

**Where it slots in:** Next.js middleware for route protection + a `/api/whoami` endpoint on Flask. NextAuth.js (App Router compatible) is the obvious starting point if the IdP supports OIDC.

**Trigger to start:** World Bank confirms the IdP (Azure AD, Okta, Keycloak, or custom).

---

### 4. Docker / containerisation

**What:** Dockerfile for the Flask backend and the Next.js frontend, with a docker-compose for local + a single multi-stage image for prod.

**Why deferred:** Out of scope for the modernization plan. Bare-metal venv + npm covers local dev fine. Containerisation only matters once we know the deploy target.

**Where it slots in:** Probably one Dockerfile per process, orchestrated by docker-compose or a process supervisor. Could also be a single image with both processes if we want simpler ops.

**Trigger to start:** Deploy target is known (Cloud Run? Fly.io? On-prem World Bank server? Kubernetes?).

---

### 5. Production deployment story

**What:** Process supervision (PM2 / systemd / supervisor), reverse proxy (nginx / Caddy / Cloudflare), TLS termination, log shipping, monitoring, secrets management.

**Why deferred:** Same as Docker — depends on the target environment.

**Where it slots in:** A new `deploy/` directory with environment-specific configs. Plus a runbook in `docs/`.

**Trigger to start:** Same as Docker.

---

### 6. Async job queue for long-running calls

**What:** Move `/api/export_polygon_network_s2` (currently 30+ seconds synchronous when it does hit GEE) onto a background queue (Celery + Redis, or RQ, or arq). Frontend polls a job-status endpoint instead of waiting on a single HTTP request.

**Why deferred:** The current synchronous model with TanStack Query progress UI and AbortController cancellation is acceptable for the analyst use case. Adding a queue is the right move once response times become a real blocker for users (e.g., 60+ second exports causing browser timeouts).

**Where it slots in:** New Flask blueprint for job submission/status, Redis as the broker, a separate worker process supervised by `start.sh`. Frontend uses TanStack Query polling on the job ID.

**Trigger to start:** User reports of timeouts, OR moving to a serverless backend that can't hold a 30s connection (e.g., Cloud Run with default request limits).

---

### 7. Backend refactor of `application/logic/`

**What:** The GEE / osmnx / geopandas modules in `application/logic/` were not touched in the modernization. They work but could use type hints, structured logging, and tests.

**Why deferred:** Out of scope for "modernize the frontend." Low-priority compared to anything that changes user-facing behavior.

**Trigger to start:** When adding a new analytical capability that touches these modules anyway, expand scope to also tidy them.

---

### 8. Replace filesystem persistence with a database

**What:** Currently extraction outputs (`*.pkl`, `*.geojson`, `*.json`) are written to `NETINSPECT_OUTPUT_DIR` on the local filesystem. A multi-user / multi-server deployment would need a real database (PostgreSQL with PostGIS) and an object store (S3 / GCS) for the large pickles.

**Why deferred:** Single-server analyst tool is fine on filesystem for now. Migrating data layers is expensive — only do it when the load profile actually requires it.

**Trigger to start:** Multi-user deployment is being scoped, OR the local disk fills up.

---

### 9. Storybook / design system

**What:** A formal design system with Storybook component documentation.

**Why deferred:** Premature until there are >10 reusable components. The current scaffold has ~10 (Nav, PageHeader, Footer, MapView, RegionPicker, TimeSlider, IndicesChart, ResultsPanel, ClassLayerLegend, SummaryStrip, StatusCard). Right at the edge — Storybook becomes worth it on the next page.

---

### 10. Workbench keyboard shortcuts

**What:** Add keyboard shortcuts to the workbench: `R` = run extraction, `C` = clear polygon, `ESC` = deselect / close docked panel, `?` = toggle a shortcut overlay. Skip when focus is in an input field.

**Why deferred:** Right idea, wrong moment. Surfaced and deferred during the `/plan-ceo-review` of the workbench layout rebuild (CEO plan: `~/.gstack/projects/tsl-imperial-Sentinel-FYP/ceo-plans/2026-04-11-workbench-nefos-primitives.md`). Bundling shortcuts into a structural rewrite inflates risk for marginal gain. Land the layout, validate the UX, then layer shortcuts on top in a focused follow-up.

**Where it slots in:** New `app/hooks/useKeyboardShortcuts.ts` hook (subscribes to `window` keydown, checks `document.activeElement` to skip when in `<input>`/`<textarea>`/`[contenteditable]`). New `app/components/ShortcutsOverlay.tsx` triggered by `?`. Wired in `workbench/page.tsx` next to the existing `handleRun`/`handleClear`/`handleCancel` callbacks.

**Trigger to start:** After the layout rebuild lands, when you've used the workbench for ~a week and notice yourself wanting them. Or when an analyst with GIS muscle memory complains.

---

### 11. Observability baseline (metrics + traces + alerting)

**What:** The app currently has zero metrics, zero traces, and zero alerting beyond `/api/healthz` + `/api/healthz/ready`. Surfaced during Section 8 of the workbench layout CEO review. Realistic baseline: Sentry on the frontend (free tier handles low volume), `structlog` + a small `/metrics` Prometheus endpoint on Flask, plus a basic Grafana dashboard panel for request rate, p99 latency, error rate.

**Why deferred:** Fine for a single-analyst tool today. Becomes a real gap as soon as the World Bank pilot has multiple users you can't directly DM. The cost of investigating "user X says it's broken" without metrics is hours; with metrics it's minutes.

**Where it slots in:** Sentry SDK in `application/web/server/app/layout.tsx` (frontend) and `application/web/app.py` (backend). `prometheus_client` for the Flask metrics endpoint. Grafana docker compose for local dev. `start.sh` does NOT need to change. CI does NOT need to change.

**Trigger to start:** Production deploy is being scoped (intersects with TODOS items 4 and 5), OR a real user reports a bug you can't reproduce.

---

### 12. DESIGN.md and design system documentation

**What:** Sentinel-FYP currently has no `DESIGN.md`. The implicit design system is "match metis with literal slate values." This works while the surface is small but breaks down as more contributors touch the codebase. The workbench rebuild introduces 5 new primitives (`AppSidebar`, `SidebarSection`, `SidebarEntry`, `DockedPanel`, `MapControls`) and a 16-row token mapping table — that's the seed of a real design system that should be locked in writing.

**Why deferred:** Surfaced in Pass 5 of the workbench `/plan-design-review`. The token mapping baked into the workbench plan is enough for the implementer of THIS rebuild. The next contributor will need a `DESIGN.md` to know the slate token vocabulary, the road class palette source (`application/config.py:CLASS_COLORS`), the focus ring convention, the "no decorative cards" rule, the icon library (lucide-react), and the typography (Inter via the metis convention).

**Where it slots in:** New `DESIGN.md` at the repo root. Run `/design-consultation` to scaffold it. Document: (a) the slate token mapping, (b) the road class palette source of truth, (c) the 5 ported primitives with usage examples, (d) the focus ring convention, (e) the AI-slop guardrails (no decorative cards, no emoji, utility copy, left-aligned).

**Trigger to start:** Immediately after the workbench rebuild lands, while the design decisions are still fresh in the implementer's head. ~30 minutes of CC time.

---

### 13. Session persistence / saved views

**What:** The workbench is fully ephemeral. Close the browser, your in-progress polygon is gone, your clicked road inspector selection is gone, your last extraction's results panel is gone. URL state preserves the map view (region, center, zoom, time, cloud) but not the work.

**Why deferred:** Surfaced during the `/plan-design-review` of the workbench layout rebuild (Pass 3, user-journey arc step 12). Real session-loss problem, but it belongs in a separate plan once the substrate from this rebuild is in place. The DockedPanel + URL state hook + LayerCatalog are all natural insertion points for "Saved views."

**Where it slots in:** A new `SidebarSection` "Saved views" with `SidebarEntry` rows for each saved view. New backend table or filesystem store for view metadata (polygon coords, region, time, cloud, filename, optional name and notes). New `/api/views` CRUD endpoints. The DockedPanel gains a "Save view" action. The LayerCatalog can hold a "Saved view boundary" overlay layer.

**Trigger to start:** After the layout rebuild lands and either (a) a real user reports losing work, or (b) the World Bank pilot demo plan calls for shareable saved analyses.

---

### 14. Don't reintroduce things that were deleted

- `application/prototype.py` — Streamlit prototype, removed in v2. Any analyst workflows that lived there should be ported into the Next.js workbench, NOT resurrected.
- `application/web/static/` and `application/web/templates/` — legacy vanilla JS frontend. Deleted at the end of Phase 2. The new frontend lives entirely in `application/web/server/`.
- The hand-rolled `_simplify_geom` wrapper, `forceRender` hook hack, hardcoded `/Users/miranda/...` path, `wait -n` in `start.sh`, top-level Leaflet import in modules used by SSR — all caught by review and removed. Don't bring them back.

---

## Known limitations / quirks (not bugs, but worth knowing)

- **`region_summaries` cold call is ~2 seconds.** The first request to `/api/regions/details` reads the 95 MB shapefile and reprojects to EPSG:3857. Every subsequent request is cached at the LRU level and returns in ~2 ms. Users hit the cold call exactly once per server restart.
- **`overview_layers_for_region` cold call is ~3 seconds for Greater Accra.** Same shapefile load + a 95k-feature geometry simplify + JSON serialization. Greater Accra is the worst case (20k of 95k features ship as ~17 MB JSON, which gzips to ~2 MB on the wire). Smaller regions are sub-second cold.
- **Flask process resident memory after warm-up is ~800 MB - 1 GB.** That's the cost of holding the shapefile + parquet + the cached overview responses in memory. Acceptable for an analyst tool; would need attention for a deploy.
- **`area_km2` in `/api/regions/details` is the bounding box area, not the true admin area.** See "True administrative region polygons" above. Greater Accra reports ~9,126 km² instead of ~3,245 km².
- **Sentinel-2 indices are only available for 2020-2023.** The pre-computed parquet covers `year={2020,2021,2022,2023}`. Newer years require either a fresh GEE export pipeline run, or a live `/api/export_polygon_network_s2` call (which still uses GEE).
- **The legacy `/api/road_stats` and `/api/random_road_stats` endpoints still go through GEE.** They're not used by the new workbench. Either delete them or port them to local data when the workbench gains a click-to-query feature.

---

## How to graduate a TODO

1. The trigger happens (deploy target chosen, user complaint, scope expansion).
2. Open a new branch.
3. Write a focused plan (`/plan` or just a short design doc).
4. Run `/plan-eng-review` on the plan.
5. Implement.
6. Move the entry from this file to the "Done in v2" section.
