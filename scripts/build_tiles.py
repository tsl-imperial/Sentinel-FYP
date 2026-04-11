#!/usr/bin/env python3
"""
Build the Network Inspector road vector tile.

Reads data/gis_osm_roads_free_1.shp via geopandas, writes a temporary GeoJSONSeq
intermediate, shells out to tippecanoe to produce a single .pmtiles file, and
copies the result into the Next.js public/ directory so the workbench MapLibre
map can range-read it via pmtiles://.

This script is run MANUALLY by a developer after the source shapefile updates.
It is NOT wired into setup.sh or CI — the .pmtiles output is committed to git
alongside the rest of the data/ artifacts (consistent with how the shapefile
itself is stored).

Usage:
    python scripts/build_tiles.py [--force]

Idempotent: skips rebuild if the output is newer than the source shapefile.
Pass --force to rebuild unconditionally.

Requires:
    - tippecanoe on PATH (brew install tippecanoe / apt install tippecanoe)
    - geopandas (already in requirements.txt)
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SHAPEFILE = REPO_ROOT / "data" / "gis_osm_roads_free_1.shp"
OUTPUT = REPO_ROOT / "frontend" / "public" / "tiles" / "ghana_roads.pmtiles"

# Tippecanoe configuration. Tuned during the first real build:
#   --minimum-zoom=4   Ghana fits inside zoom 4. Don't waste bytes at z 0-3.
#   --maximum-zoom=12  Past z 12 the user is looking at neighborhood streets;
#                       MapLibre over-zooms from z 12 tiles for higher zooms.
#                       (z 14 was the original guess; produced a 79 MB file.
#                       Dropping to z 12 + the default tile cap brings it to
#                       under 30 MB.)
#   --drop-densest-as-needed  At low zooms, drop the densest features (residential
#                              roads in cities) so tiles fit. Target retained
#                              features are picked uniformly so the look is even.
#   --extend-zooms-if-still-dropping  If a higher zoom still has overflow, add
#                                       even more max zooms automatically.
#   --include=fclass,name,osm_id  Only the properties needed at render time.
#   --simplification=15  Aggressive Douglas-Peucker simplification at the tile
#                         pixel level (default is 10). Cuts vertex count by ~30%
#                         with no visible difference at any reasonable zoom.
#   --layer=roads  Single layer name.
#
# DELIBERATELY NOT SET:
#   --no-tile-size-limit — letting tiles grow unbounded ballooned the file to
#                          79 MB. The default 500 KB cap is the right call.
TIPPECANOE_FLAGS = [
    "--layer=roads",
    "--minimum-zoom=4",
    "--maximum-zoom=12",
    "--drop-densest-as-needed",
    "--extend-zooms-if-still-dropping",
    "--include=fclass",
    "--include=name",
    "--include=osm_id",
    "--simplification=15",
    "--force",
]


def fail(msg: str, hint: str | None = None) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    if hint:
        print(f"hint:  {hint}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Rebuild even if output is up-to-date")
    args = parser.parse_args()

    # Pre-flight checks. Fail loudly with actionable messages.
    if not SHAPEFILE.exists():
        fail(
            f"Shapefile not found at {SHAPEFILE}",
            "download via: curl -L -o /tmp/geofabrik-ghana.zip "
            "https://download.geofabrik.de/africa/ghana-latest-free.shp.zip && "
            "unzip -j /tmp/geofabrik-ghana.zip 'gis_osm_roads_free_1.*' -d data/",
        )

    if shutil.which("tippecanoe") is None:
        fail(
            "tippecanoe not found on PATH",
            "install: brew install tippecanoe (macOS) OR apt install tippecanoe (Ubuntu 24.04+)",
        )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    # Idempotency: skip rebuild if output is newer than the shapefile.
    if not args.force and OUTPUT.exists():
        if OUTPUT.stat().st_mtime > SHAPEFILE.stat().st_mtime:
            print(f"OK: {OUTPUT.relative_to(REPO_ROOT)} is up-to-date (use --force to rebuild)")
            return

    print(f"→ Reading {SHAPEFILE.relative_to(REPO_ROOT)}")
    # geopandas import is deferred so the script can fail with a clear message
    # earlier if the venv isn't active.
    try:
        import geopandas as gpd
    except ImportError:
        fail(
            "geopandas not importable",
            "activate the venv: source .venv/bin/activate (or run ./setup.sh first)",
        )

    gdf = gpd.read_file(SHAPEFILE)
    print(f"  {len(gdf)} features")

    # Slim the dataframe to just the columns tippecanoe will keep. Saves both the
    # geojsonseq write and the tippecanoe input parse.
    keep_cols = [c for c in ("osm_id", "fclass", "name", "geometry") if c in gdf.columns]
    gdf_slim = gdf[keep_cols]

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".geojsonseq", delete=False, dir="/tmp"
    ) as tmp:
        tmp_path = Path(tmp.name)

    try:
        print(f"→ Writing intermediate {tmp_path}")
        # GeoJSONSeq is line-delimited GeoJSON, the format tippecanoe likes for
        # streaming-large-input. Pyogrio writes it via the GDAL driver name.
        gdf_slim.to_file(tmp_path, driver="GeoJSONSeq")

        print(f"→ Running tippecanoe → {OUTPUT.relative_to(REPO_ROOT)}")
        cmd = ["tippecanoe", "-o", str(OUTPUT), *TIPPECANOE_FLAGS, str(tmp_path)]
        result = subprocess.run(cmd, check=False)
        if result.returncode != 0:
            fail(f"tippecanoe exited with status {result.returncode}")
    finally:
        tmp_path.unlink(missing_ok=True)

    size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    print(f"OK: built {OUTPUT.relative_to(REPO_ROOT)} ({size_mb:.1f} MB)")
    print()
    print("Next: commit the rebuilt tile")
    print(f"  git add {OUTPUT.relative_to(REPO_ROOT)}")
    print('  git commit -m "data: rebuild ghana_roads.pmtiles"')


if __name__ == "__main__":
    main()
