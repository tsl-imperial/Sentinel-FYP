"""
Network Inspector — local data backend.

Reads from data/ instead of going through Earth Engine. Lets the workbench
run with zero GEE auth.

Data sources:
  data/gis_osm_roads_free_1.{shp,dbf,shx,prj,cpg}  Ghana OSM roads with attrs
  data/roads_region_lookup.csv                      osm_id -> region
  data/ghana_parquet/year=*/                        per-(osm_id, quarter) S2 indices

All loaders are lazy + cached so the module is cheap to import. The first call
to a heavy function (e.g. roads_geojson_for_region) takes a few seconds; later
calls are constant-time via @lru_cache.
"""

from __future__ import annotations

import functools
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import geopandas as gpd
import pandas as pd
from shapely.geometry import mapping

from application import config


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"

ROADS_SHP = DATA_DIR / "gis_osm_roads_free_1.shp"
REGION_LOOKUP_CSV = DATA_DIR / "roads_region_lookup.csv"
GHANA_PARQUET_DIR = DATA_DIR / "ghana_parquet"

# Network Inspector output dir resolution. NOT cached at module level: pytest
# reloads application.web.app to pick up env var changes (tests R2/R3) and a
# stale module-level constant would defeat that. Both call sites
# (app.OUTPUT_DIR and list_export_files) call this function instead.
def output_dir() -> Path:
    """Resolve NETINSPECT_OUTPUT_DIR per call. Relative paths anchor to the
    repo root, NOT the current working directory. Locks the regression where
    the previous hardcoded /Users/miranda/... path made the backend unusable
    on any other machine.
    """
    configured = os.environ.get("NETINSPECT_OUTPUT_DIR")
    if configured:
        p = Path(configured)
        return p if p.is_absolute() else (REPO_ROOT / p).resolve()
    return REPO_ROOT / "outputs"


CLASS_COLORS = config.CLASS_COLORS
OVERVIEW_CLASSES: list[str] = list(config.TOP10)

INDEX_COLS: tuple[str, ...] = ("NDVI", "NDMI", "NDBI", "NDWI", "BSI")

# Suffix → kind mapping for export file grouping. Module-level so the value is
# allocated once and the contract is visible from outside the module.
EXPORT_SUFFIXES: tuple[tuple[str, str], ...] = (
    ("_network.pkl", "network_pickle"),
    ("_network_edges.geojson", "edges_geojson"),
    ("_sentinel_stats.json", "sentinel_stats"),
)


# ─────────────────────────────────────────────────────────────────────────────
# Loaders (cached)
# ─────────────────────────────────────────────────────────────────────────────


@functools.lru_cache(maxsize=1)
def _load_roads() -> gpd.GeoDataFrame:
    """Load the full Ghana OSM road shapefile."""
    gdf = gpd.read_file(ROADS_SHP)
    gdf["osm_id"] = gdf["osm_id"].astype(str)
    return gdf


@functools.lru_cache(maxsize=1)
def _load_region_lookup() -> pd.DataFrame:
    df = pd.read_csv(REGION_LOOKUP_CSV, usecols=["osm_id", "region"])
    df["osm_id"] = df["osm_id"].astype(str)
    return df


@functools.lru_cache(maxsize=1)
def _load_indices() -> pd.DataFrame:
    """Concatenate every year's parquet, indexed by (osm_id, year, quarter) for
    O(log n) lookups instead of full-table scans.
    """
    frames: list[pd.DataFrame] = []
    for year_dir in sorted(GHANA_PARQUET_DIR.glob("year=*")):
        try:
            year = int(year_dir.name.split("=", 1)[1])
        except (IndexError, ValueError):
            continue
        # Each year directory has duplicate-content files (different export
        # hashes). Reading the first one is sufficient.
        files = sorted(year_dir.glob("*.parquet"))
        if not files:
            continue
        df = pd.read_parquet(files[0])
        df["year"] = year
        df["osm_id"] = df["osm_id"].astype(str)
        frames.append(df)
    if not frames:
        empty_cols = ["fclass", *INDEX_COLS]
        return pd.DataFrame(columns=empty_cols, index=pd.MultiIndex.from_tuples(
            [], names=["osm_id", "year", "quarter"]))
    df = pd.concat(frames, ignore_index=True)
    return df.set_index(["osm_id", "year", "quarter"]).sort_index()


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────


@functools.lru_cache(maxsize=1)
def list_regions() -> list[str]:
    """Return Ghana administrative regions, alphabetically sorted, with a
    synthetic 'Ghana' entry first that maps to whole-country bounds.
    """
    lookup = _load_region_lookup()
    regions = sorted(lookup["region"].dropna().unique().tolist())
    return ["Ghana", *regions]


@functools.lru_cache(maxsize=32)
def _osm_ids_in_region(region: str) -> frozenset[str]:
    lookup = _load_region_lookup()
    return frozenset(lookup.loc[lookup["region"] == region, "osm_id"].tolist())


def _roads_in_region(region: str) -> gpd.GeoDataFrame:
    roads = _load_roads()
    if region == "Ghana":
        return roads
    osm_ids = _osm_ids_in_region(region)
    if not osm_ids:
        return roads.iloc[0:0]
    return roads[roads["osm_id"].isin(osm_ids)]


@functools.lru_cache(maxsize=32)
def region_center(region: str) -> tuple[float, float]:
    """[lat, lng] centroid of the union of all road geometries in the region."""
    sub = _roads_in_region(region)
    if sub.empty:
        raise ValueError(f"region not found: {region}")
    minx, miny, maxx, maxy = sub.total_bounds
    return ((miny + maxy) / 2, (minx + maxx) / 2)


@functools.lru_cache(maxsize=32)
def boundary_geojson_for_region(region: str) -> dict[str, Any] | None:
    """Region outline as a GeoJSON FeatureCollection (single Polygon).

    Uses the convex hull of all road geometries in the region. Not the true
    admin polygon, but visually adequate as an outline and requires no
    separate adm1 file.
    """
    sub = _roads_in_region(region)
    if sub.empty:
        return None
    hull = sub.unary_union.convex_hull
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"region": region},
                "geometry": mapping(hull),
            }
        ],
    }


def _row_to_index_dict(row: pd.Series, lowercase: bool = False) -> dict[str, float | None]:
    """Extract the 5 Sentinel-2 indices from a single parquet row, coercing
    pandas NaN → None so the result is JSON-serialisable. `lowercase=True`
    matches the frontend zod schema in `roadIndices.ts` (used by the
    `/api/road_indices` route); the default keeps the uppercase keys used
    by the legacy notebook helpers.
    """
    out: dict[str, float | None] = {}
    for col in INDEX_COLS:
        key = col.lower() if lowercase else col
        val = row[col] if col in row.index else None
        out[key] = float(val) if val is not None and pd.notna(val) else None
    return out


def indices_for_road(osm_id: str, year: int, quarter: str) -> dict[str, float | None] | None:
    """Look up Sentinel-2 mean indices for a single road segment, year, quarter."""
    df = _load_indices()
    try:
        row = df.loc[(str(osm_id), year, quarter)]
    except KeyError:
        return None
    if isinstance(row, pd.DataFrame):
        row = row.iloc[0]
    return _row_to_index_dict(row)


def indices_for_osm_id_all_years(osm_id: str) -> list[dict[str, Any]]:
    """All Sentinel-2 mean indices for a single road across every year/quarter
    in the parquet. Used by the workbench hover popup and click-to-dock road
    inspector — both endpoints share `/api/road_indices?osm_id=` and the
    frontend filters client-side per the design review (Pass 2).

    Returns a list of `{year, quarter, ndvi, ndmi, ndbi, ndwi, bsi}` dicts
    sorted most-recent first. Returns `[]` if the osm_id is not in the
    parquet (the road exists in OSM but Sentinel indices were never computed
    for it). The endpoint translates `[]` to `200 {indices: []}`, NOT 404 —
    the road still exists, the indices just aren't there. The popup falls
    back to `(no indices)` per the design-review failure spec.

    O(log n) lookup via the existing `(osm_id, year, quarter)` MultiIndex on
    `_load_indices()`. No new caching layer.
    """
    df = _load_indices()
    try:
        sub = df.xs(str(osm_id), level="osm_id")
    except KeyError:
        return []
    rows: list[dict[str, Any]] = []
    for idx, row in sub.iterrows():
        # After xs() drops the osm_id level, the remaining MultiIndex is
        # (year, quarter). Pandas iterrows yields the index tuple as `idx`.
        if isinstance(idx, tuple):
            year, quarter = idx
        else:
            year, quarter = idx, ""
        entry: dict[str, Any] = {"year": int(year), "quarter": str(quarter)}
        entry.update(_row_to_index_dict(row, lowercase=True))
        rows.append(entry)
    # Most recent first: (year desc, quarter desc lexical — Q4 > Q3 > Q2 > Q1).
    rows.sort(key=lambda r: (r["year"], r["quarter"]), reverse=True)
    return rows


def indices_for_polygon(
    osm_ids: Iterable[str],
    year: int,
    quarter: str,
) -> dict[str, float | None]:
    """Mean Sentinel-2 indices over a set of osm_ids for a (year, quarter).

    Local replacement for the GEE reduceRegion call inside the export endpoint.
    """
    df = _load_indices()
    ids = [str(x) for x in osm_ids]
    if not ids:
        return {col: None for col in INDEX_COLS}
    try:
        # MultiIndex slice: all rows matching (osm_id ∈ ids, year, quarter).
        sub = df.loc[(ids, year, quarter), :]
    except KeyError:
        return {col: None for col in INDEX_COLS}
    if sub.empty:
        return {col: None for col in INDEX_COLS}
    # .mean() ignores NaN by default — same NaN semantics as indices_for_road.
    return {col: float(sub[col].mean()) for col in INDEX_COLS}


@functools.lru_cache(maxsize=1)
def region_summaries() -> tuple:
    """Per-region metrics for the /regions page.

    Returns a tuple of dicts:
        ({"name", "road_km", "edge_count", "area_km2", "class_composition"}, ...)

    Pipeline:
      1. Pre-filter to roads that have a region mapping (~95k of 374k).
      2. Project just that subset to EPSG:3857 for metric length sums.
      3. Single groupby per region pass that produces all the columns at once.
      4. Bounding-box area instead of convex-hull area (the convex hull on
         95k LineStrings is the dominant cost; bbox area is a cheap proxy
         that the user sees as a stat, not a geometric truth).

    LRU-cached to maxsize=1 so warm calls are constant-time. The metric GDF
    is local to this function so it gets GC'd after the summary tuple is
    built — keeps process memory bounded.
    """
    roads = _load_roads()
    lookup = _load_region_lookup()

    # Inner-merge first so we only project + measure the ~95k roads that
    # actually map to a region (out of 374k total).
    joined = roads[["osm_id", "fclass", "geometry"]].merge(lookup, on="osm_id", how="inner")
    joined = joined[joined["fclass"].isin(OVERVIEW_CLASSES)]
    if joined.empty:
        return tuple()

    # Project the filtered subset to a metric CRS. Mercator overstates length
    # away from the equator but for Ghana (4-11°N) the cosine factor is ~0.99
    # so the error is sub-1%. EPSG:32630 (Ghana UTM) would be more accurate.
    joined = gpd.GeoDataFrame(joined, geometry="geometry", crs=roads.crs).to_crs(epsg=3857)
    joined["length_m"] = joined.geometry.length

    # Single groupby pass for everything. minx/miny/maxx/maxy come from
    # vectorised .geometry.bounds (a DataFrame of shape (n, 4)).
    bounds = joined.bounds  # adds minx, miny, maxx, maxy columns to the gdf
    joined = joined.assign(**{c: bounds[c] for c in ("minx", "miny", "maxx", "maxy")})

    by_region = joined.groupby("region", sort=False).agg(
        road_m=("length_m", "sum"),
        edge_count=("length_m", "count"),
        minx=("minx", "min"),
        miny=("miny", "min"),
        maxx=("maxx", "max"),
        maxy=("maxy", "max"),
    )
    by_region["area_km2"] = (by_region["maxx"] - by_region["minx"]) * (by_region["maxy"] - by_region["miny"]) / 1e6

    by_region_class_km = (
        joined.groupby(["region", "fclass"], sort=False)["length_m"].sum() / 1000.0
    )

    summaries: list[dict[str, Any]] = []
    for region in sorted(by_region.index):
        row = by_region.loc[region]
        composition = {
            cls: float(by_region_class_km.get((region, cls), 0.0)) for cls in OVERVIEW_CLASSES
        }
        summaries.append({
            "name": region,
            "road_km": float(row["road_m"]) / 1000.0,
            "edge_count": int(row["edge_count"]),
            "area_km2": float(row["area_km2"]),
            "class_composition": composition,
        })
    return tuple(summaries)


def class_palette() -> dict[str, Any]:
    """Color palette + canonical order for the OSM road classes the frontend
    surfaces. Served alongside region summaries so the frontend doesn't have
    to maintain its own copy of the palette.
    """
    return {
        "order": list(OVERVIEW_CLASSES),
        "colors": {cls: CLASS_COLORS.get(cls, "#94a3b8") for cls in OVERVIEW_CLASSES},
    }


def list_export_files() -> list[dict[str, Any]]:
    """List Network Inspector exports in OUTPUT_DIR, grouped by prefix.

    The export pipeline writes three files per run sharing a common stem,
    e.g. accra_central_2024Q3_network.pkl, _network_edges.geojson,
    _sentinel_stats.json. Sorted newest first by mtime.
    """
    from collections import defaultdict

    grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "files": [],
        "total_bytes": 0,
        "latest_mtime": 0.0,
    })

    od = output_dir()
    try:
        entries = list(od.iterdir())
    except FileNotFoundError:
        return []

    for path in entries:
        if not path.is_file():
            continue
        prefix: str | None = None
        kind: str | None = None
        for suffix, kind_name in EXPORT_SUFFIXES:
            if path.name.endswith(suffix):
                prefix = path.name[: -len(suffix)]
                kind = kind_name
                break
        if prefix is None:
            continue
        st = path.stat()
        bucket = grouped[prefix]
        bucket["files"].append({
            "name": path.name,
            "kind": kind,
            "size_bytes": st.st_size,
            "url": f"/api/exports/file/{path.name}",
        })
        bucket["total_bytes"] += st.st_size
        if st.st_mtime > bucket["latest_mtime"]:
            bucket["latest_mtime"] = st.st_mtime

    out: list[dict[str, Any]] = []
    for prefix, bucket in grouped.items():
        bucket["files"].sort(key=lambda f: f["name"])
        out.append({
            "prefix": prefix,
            "created_at": datetime.fromtimestamp(bucket["latest_mtime"], tz=timezone.utc).isoformat(timespec="seconds"),
            "total_bytes": bucket["total_bytes"],
            "files": bucket["files"],
        })
    out.sort(key=lambda e: e["created_at"], reverse=True)
    return out


def is_local_data_available() -> tuple[bool, list[str]]:
    needed = [ROADS_SHP, REGION_LOOKUP_CSV, GHANA_PARQUET_DIR]
    missing = [str(p) for p in needed if not p.exists()]
    return (len(missing) == 0, missing)
