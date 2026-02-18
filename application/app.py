# prototype.py  (FAST demo-ready + whole-road stats + 6-month window)
#
# What this version does (per your requirements):
# - Map 1 in Tab 1 (overview, coloured, with road-class meaning text)
# - Map 2 split into tabs by road class (service removed):
#     residential, primary, secondary, trunk, tertiary, unclassified
# - 6-month Sentinel window (Jan–Jun or Jul–Dec) kept
# - Click near a road:
#     ✅ identifies nearest road (tolerance increased + adaptive by zoom)
#     ✅ highlights that road in RED
#     ✅ shows OSM properties + Sentinel mean features for the ENTIRE road corridor
# - Maintains zoom/center when the road lights up red
# - Speeds up click→stats with:
#     ✅ caching stats by (osm_id, class, region, year, quarter, cloud, buffer, scale)
#     ✅ fewer bands (B4, B8, B11) + indices only
#     ✅ geometry simplification before reduction (reduces vertex complexity, keeps whole road)
#     ✅ coarser scale default (20m) adjustable
#
# Notes:
# - Streamlit+folium reruns on click. To make the RED overlay + stats appear "together",
#   we store results in session_state and immediately rerun once.

import os
import streamlit as st
import folium
from streamlit_folium import st_folium
import ee

# -----------------------------
# Streamlit page config + CSS
# -----------------------------
st.set_page_config(page_title="Ghana Roads (OSM) + Sentinel-2 (GEE)", layout="wide")

st.markdown(
    """
    <style>
      .stApp { background-color: #0f1116; color: #e7e7e7; }
      h1, h2, h3, h4 { color: #ffffff; }
      .block-container { padding-top: 1rem; padding-bottom: 2rem; }
      .stMarkdown, .stText, .stCaption { color: #e7e7e7; }
      .small { font-size: 0.9rem; opacity: 0.9; }
      .card { background: rgba(255,255,255,0.06); padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.10); }
      code { color: #d7d7d7; }
    </style>
    """,
    unsafe_allow_html=True,
)

# -----------------------------
# Earth Engine init
# -----------------------------
PROJECT_ID = os.environ.get("EE_PROJECT", "sentinel-487715")

@st.cache_resource
def ee_init():
    ee.Initialize(project=PROJECT_ID)
    return True

ee_init()

# -----------------------------
# Assets / datasets
# -----------------------------
ROADS_ASSET = "projects/sentinel-487715/assets/ghana_roads"
REGIONS_FC_ID = "projects/sat-io/open-datasets/WORLD-BANK/WBGAD/WB_GAD_ADM1"

GHANA_FC = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(ee.Filter.eq("country_na", "Ghana"))
GHANA_GEOM = GHANA_FC.geometry()

# -----------------------------
# Road classes
# -----------------------------
TOP10 = [
    "residential", "service", "unclassified", "path", "track",
    "tertiary", "footway", "secondary", "trunk", "primary",
]

# Map 2 tabs requested (service removed)
TABBED_CLASSES = ["residential", "primary", "secondary", "trunk", "tertiary", "unclassified"]

CLASS_COLORS = {
    "residential": "#1f77b4",
    "service": "#ff7f0e",
    "unclassified": "#d62728",
    "path": "#9467bd",
    "track": "#8c564b",
    "tertiary": "#e377c2",
    "footway": "#17becf",
    "secondary": "#2ca02c",
    "trunk": "#bcbd22",
    "primary": "#000000",
}

# -----------------------------
# Helpers
# -----------------------------
def ee_tile_layer(image: ee.Image, vis: dict):
    m = image.getMapId(vis)
    return m["tile_fetcher"].url_format

def roads_fc_for_geom(geom: ee.Geometry, classes):
    return (
        ee.FeatureCollection(ROADS_ASSET)
        .filterBounds(geom)
        .filter(ee.Filter.inList("fclass", ee.List(classes)))
    )

def ee_fc_to_paint_image(fc: ee.FeatureCollection, color_hex: str, width: int = 2):
    img = ee.Image().byte().paint(featureCollection=fc, color=1, width=width)
    vis = {"min": 0, "max": 1, "palette": [color_hex.replace("#", "")]}
    return img.visualize(**vis)

def regions_fc_ghana():
    return ee.FeatureCollection(REGIONS_FC_ID).filter(ee.Filter.eq("NAM_0", "Ghana"))

@st.cache_data(show_spinner=False)
def list_regions_ghana():
    names = regions_fc_ghana().aggregate_array("NAM_1").distinct().sort().getInfo()
    return names if isinstance(names, list) else []

@st.cache_data(show_spinner=False)
def region_geom_center(region_name: str):
    """Cache region geometry and center to reduce repeated getInfo calls."""
    fc = regions_fc_ghana()
    sub = fc.filter(ee.Filter.eq("NAM_1", region_name))
    if sub.size().getInfo() == 0:
        return None, None
    geom = sub.geometry().dissolve().simplify(10)
    if geom.area(1).getInfo() <= 0:
        return None, None
    cen = geom.centroid(1).coordinates().getInfo()
    center_lat, center_lon = cen[1], cen[0]
    return geom, (center_lat, center_lon)

# -----------------------------
# Sentinel helpers (3-month / quarterly window)
# -----------------------------
def s2_composite_quarter(year: int, quarter: str, region_geom: ee.Geometry, cloud: int = 30):

    # Define quarterly date ranges
    ranges = {
        "Jan–Mar": ("01-01", "03-31"),
        "Apr–Jun": ("04-01", "06-30"),
        "Jul–Sep": ("07-01", "09-30"),
        "Oct–Dec": ("10-01", "12-31"),
    }

    start_mmdd, end_mmdd = ranges[quarter]
    start = f"{year}-{start_mmdd}"
    end = f"{year}-{end_mmdd}"

    s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(region_geom)
        .filterDate(start, end)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud))
        # small bandset for speed; enough for NDVI/NDMI/SWIR_NIR
        .select(["B4", "B8", "B11"])
    )

    if s2.size().getInfo() == 0:
        return None

    return s2.median().clip(region_geom)


def s2_features(comp: ee.Image):
    ndvi = comp.normalizedDifference(["B8", "B4"]).rename("NDVI")
    ndmi = comp.normalizedDifference(["B8", "B11"]).rename("NDMI")
    swir_nir = comp.select("B11").divide(comp.select("B8")).rename("SWIR_NIR")
    return comp.addBands([ndvi, ndmi, swir_nir])


# -----------------------------
# Road selection + stats (whole road)
# -----------------------------
def _adaptive_search_m(zoom: int | None) -> int:
    # Bigger tolerance when zoomed out
    if zoom is None:
        return 350
    if zoom <= 8:
        return 1200
    if zoom <= 10:
        return 700
    if zoom <= 12:
        return 450
    if zoom <= 14:
        return 250
    return 180

def nearest_road_feature(region_geom: ee.Geometry, road_class: str, lon: float, lat: float, search_m: int):
    pt = ee.Geometry.Point([lon, lat])
    buf = pt.buffer(search_m)

    roads = roads_fc_for_geom(region_geom, [road_class]).filterBounds(buf)

    def add_dist(f):
        return f.set("dist_m", f.geometry().distance(pt))

    return ee.Feature(roads.map(add_dist).sort("dist_m").first())

@st.cache_data(show_spinner=False)
def compute_road_stats_cached(
    region_name: str,
    road_class: str,
    osm_id: str,
    year: int,
    quarter: str,
    cloud: int,
    buffer_m: int,
    scale_m: int,
    simplify_m: int,
):
    """
    Cached whole-road stats by osm_id.
    This is the main speed boost for click→stats (repeat clicks become instant).
    """
    region_geom, _ = region_geom_center(region_name)
    if region_geom is None:
        return None

    # Re-load the road by osm_id, restricted by region + class for safety
    road_fc = (
        roads_fc_for_geom(region_geom, [road_class])
        .filter(ee.Filter.eq("osm_id", osm_id))
    )

    # Sometimes the attribute might be "id" depending on your dataset.
    # If osm_id filter fails, fallback to "id".
    if road_fc.size().getInfo() == 0:
        road_fc = roads_fc_for_geom(region_geom, [road_class]).filter(ee.Filter.eq("id", osm_id))
        if road_fc.size().getInfo() == 0:
            return None

    road = ee.Feature(road_fc.first())

    comp = s2_composite_quarter(year, quarter, region_geom, cloud=cloud)
    if comp is None:
        return None

    feat_img = s2_features(comp)

    # Speed: simplify the road geometry a bit before buffering
    # (keeps "whole road" but reduces vertex complexity)
    geom = road.geometry().simplify(simplify_m).buffer(buffer_m)

    stats = feat_img.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geom,
        scale=scale_m,
        maxPixels=1e7,
        tileScale=8,
        bestEffort=True
    )
    return stats.getInfo()

# -----------------------------
# Session-state utilities
# -----------------------------
def _view_key(road_class: str, region_name: str):
    return f"view_{road_class}_{region_name}"

def _sel_key(road_class: str, region_name: str):
    return f"selection_{road_class}_{region_name}"

def _results_key(road_class: str, region_name: str):
    return f"results_{road_class}_{region_name}"

# -----------------------------
# App UI
# -----------------------------
st.title("Ghana OSM roads + Sentinel-2 (prototype — demo mode)")
st.markdown(
    '<div class="small">Map 2 click: identify road → highlight red → show whole-road Sentinel means (cached for speed). Zoom is preserved when you click.</div>',
    unsafe_allow_html=True
)

tab_names = ["Map 1 (Overview)"] + [f"Map 2 — {c}" for c in TABBED_CLASSES]
tabs = st.tabs(tab_names)

# -----------------------------
# TAB 1: Map 1 Overview
# -----------------------------
with tabs[0]:
    st.subheader("Map 1 — OSM roads overview (top 10 road classes, colour-coded)")
    m1 = folium.Map(location=[7.95, -1.0], zoom_start=7, tiles="cartodbpositron")

    roads_all = (
        ee.FeatureCollection(ROADS_ASSET)
        .filterBounds(GHANA_GEOM)
        .filter(ee.Filter.inList("fclass", ee.List(TOP10)))
    )

    for cls in TOP10:
        color = CLASS_COLORS[cls]
        fc_cls = roads_all.filter(ee.Filter.eq("fclass", cls))
        painted = ee_fc_to_paint_image(fc_cls, color_hex=color, width=2).clip(GHANA_GEOM)
        tile_url = ee_tile_layer(painted, {})
        layer_name = f'<span style="color:{color};font-weight:900">■</span> {cls}'
        folium.raster_layers.TileLayer(
            tiles=tile_url,
            attr="Google Earth Engine",
            name=layer_name,
            overlay=True,
            control=True,
            opacity=0.95,
        ).add_to(m1)

    folium.LayerControl(collapsed=False).add_to(m1)
    st_folium(m1, height=520, width=None)

    st.markdown(
        """
<div class="card">
<b>Meaning of the 10 OSM road classes (fclass)</b><br/>
<ul>
  <li><b>primary</b>: major national roads linking key cities/towns.</li>
  <li><b>trunk</b>: very high-importance routes (often close to motorway standard where present).</li>
  <li><b>secondary</b>: important regional connectors (below primary/trunk).</li>
  <li><b>tertiary</b>: connects smaller towns/areas to the higher network.</li>
  <li><b>unclassified</b>: public roads that don’t fit neatly into the hierarchy above (still drivable roads).</li>
  <li><b>residential</b>: streets within residential neighbourhoods.</li>
  <li><b>service</b>: access roads for buildings/facilities/industrial areas/parking.</li>
  <li><b>track</b>: rural/agricultural tracks (often unpaved, variable quality).</li>
  <li><b>path</b>: narrow paths (walking/cycling; can be informal).</li>
  <li><b>footway</b>: primarily pedestrian routes.</li>
</ul>
</div>
""",
        unsafe_allow_html=True,
    )

# -----------------------------
# TABS 2+: Map 2 per road-class  (MAP LEFT, RESULTS RIGHT)
# -----------------------------
region_names = list_regions_ghana()
default_region_idx = region_names.index("Greater Accra") if "Greater Accra" in region_names else 0

for i, road_class in enumerate(TABBED_CLASSES, start=1):
    with tabs[i]:
        st.subheader(f"Map 2 — {road_class} roads (click to select + stats)")

        # Controls (top row)
        c1, c2, c3, c4, c5 = st.columns([2, 1, 1, 1, 1])
        with c1:
            region_name = st.selectbox(
                "Region",
                region_names,
                index=default_region_idx,
                key=f"region_{road_class}",
            )
        with c2:
            year = st.slider(
                "Year",
                2017,
                2025,
                2023,
                1,
                key=f"year_{road_class}",
            )
        with c3:
            quarter = st.selectbox(
                "Quarter",
                ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"],
                key=f"quarter_{road_class}",  # ✅ FIX duplicate ID
            )
        with c4:
            cloud = st.slider(
                "Max cloud (%)",
                0,
                90,
                30,
                5,
                key=f"cloud_{road_class}",
            )
        with c5:
            scale_m = st.selectbox(
                "Stats resolution",
                [10, 20, 30, 60],
                index=1,
                key=f"scale_{road_class}",
            )

        # Demo defaults (speed + stability)
        buffer_m = 12          # corridor around the road line
        simplify_m = 25        # simplify geometry before buffering (speed win)

        # Load region geometry + center
        reg_geom, region_center = region_geom_center(region_name)
        if reg_geom is None:
            st.error(f"Region '{region_name}' not found or empty.")
            st.stop()

        # Maintain view (zoom/center) across reruns
        vkey = _view_key(road_class, region_name)
        if vkey not in st.session_state:
            st.session_state[vkey] = {"center": region_center, "zoom": 10}

        # Selected road + result keys
        skey = _sel_key(road_class, region_name)
        rkey = _results_key(road_class, region_name)

        # Two-column layout: MAP LEFT, RESULTS RIGHT ✅
        left, right = st.columns([3, 1.25], vertical_alignment="top")

        # -----------------------------
        # LEFT: Map
        # -----------------------------
        with left:
            center_lat, center_lon = st.session_state[vkey]["center"]
            zoom_start = st.session_state[vkey]["zoom"]

            m2 = folium.Map(
                location=[center_lat, center_lon],
                zoom_start=zoom_start,
                tiles="cartodbpositron",
                control_scale=True,
            )

            # Roads display: single class, single colour (fast)
            fc_cls = roads_fc_for_geom(reg_geom, [road_class])
            roads_img = ee_fc_to_paint_image(fc_cls, color_hex="#000000", width=2).clip(reg_geom)
            roads_url = ee_tile_layer(roads_img, {})
            folium.TileLayer(
                tiles=roads_url,
                attr="Google Earth Engine",
                name=f"{road_class} roads",
                overlay=True,
                control=False,
                opacity=1.0,
            ).add_to(m2)

            # Region border (green as you asked)
            outline_img = (
                ee.Image()
                .byte()
                .paint(ee.FeatureCollection(reg_geom), 1, 3)
                .visualize(min=0, max=1, palette=["00aa00"])
            )
            outline_url = ee_tile_layer(outline_img, {})
            folium.TileLayer(
                tiles=outline_url,
                attr="Google Earth Engine",
                name="Region boundary",
                overlay=True,
                control=False,
                opacity=1.0,
            ).add_to(m2)

            # Selected road overlay in red (stored in session_state)
            if st.session_state.get(skey):
                folium.GeoJson(
                    st.session_state[skey],
                    name="Selected road",
                    style_function=lambda _f: {"color": "#ff0000", "weight": 6, "opacity": 1.0},
                ).add_to(m2)

            # Render map
            map_key = f"map_{road_class}_{region_name}"
            out = st_folium(m2, width=1050, height=620, key=map_key)

            # Update stored view so zoom/center is preserved after reruns
            if out:
                if out.get("center") and isinstance(out["center"], dict):
                    st.session_state[vkey]["center"] = (out["center"]["lat"], out["center"]["lng"])
                if out.get("zoom") is not None:
                    st.session_state[vkey]["zoom"] = out["zoom"]

        # -----------------------------
        # RIGHT: Results / Info panel
        # -----------------------------
        with right:
            st.markdown("### Selected road")
            if st.session_state.get(rkey):
                st.json(st.session_state[rkey], expanded=True)
            else:
                st.caption("Click a road on the map to populate this panel.")

            st.markdown("---")
            st.markdown(
                """
**Features returned (why they matter for road-quality context)**  
- **NDVI**: vegetation around the road (urban vs rural corridor context).  
- **NDMI**: moisture/wetness near the road (drainage/flooding context).  
- **SWIR/NIR**: moisture/material proxy (sensitive to wet surfaces/soil/material differences).  
- **B4, B8, B11**: base bands used to compute indices; useful later as raw inputs.  

*Prototype note:* Sentinel-2 gives **context signals**, not pothole-level detail.
"""
            )

        # -----------------------------
        # Handle click (store immediately + compute stats)
        # -----------------------------
        if not out or not out.get("last_clicked"):
            st.caption(
                "Tip: zoom in and click close to the road. "
                "Tolerance increases when zoomed out, but dense areas can still be tricky."
            )
        else:
            click_lat = out["last_clicked"]["lat"]
            click_lon = out["last_clicked"]["lng"]
            zoom_now = out.get("zoom", st.session_state[vkey]["zoom"])
            search_m = _adaptive_search_m(zoom_now)

            try:
                # 1) Identify nearest road feature (single class)
                nearest = nearest_road_feature(
                    reg_geom, road_class, click_lon, click_lat, search_m=search_m
                )
                nearest_info = nearest.getInfo() if nearest is not None else None

                if not nearest_info or not nearest_info.get("properties"):
                    # IMPORTANT: write something to the panel so it doesn't look broken
                    st.session_state[rkey] = {
                        "status": "No road found",
                        "note": f"Try zooming in and clicking closer (tolerance {search_m}m).",
                        "search_tolerance_m": search_m,
                    }
                else:
                    props = nearest_info["properties"]
                    osm_id = props.get("osm_id") or props.get("id") or props.get("osmID")

                    if osm_id is None:
                        st.session_state[rkey] = {
                            "status": "Road found but missing osm_id/id",
                            "fclass": props.get("fclass"),
                            "name": props.get("name"),
                        }
                    else:
                        # 2) Store selection geometry for red overlay
                        if nearest_info.get("geometry"):
                            st.session_state[skey] = {
                                "type": "Feature",
                                "properties": {
                                    "osm_id": osm_id,
                                    "fclass": props.get("fclass"),
                                    "name": props.get("name"),
                                },
                                "geometry": nearest_info["geometry"],
                            }

                        # 3) Write an IMMEDIATE payload so the right panel updates instantly
                        base_payload = {
                            "status": "Selected road (computing stats...)",
                            "osm_id": osm_id,
                            "fclass": props.get("fclass"),
                            "name": props.get("name"),
                            "distance_from_click_m": props.get("dist_m"),
                            "search_tolerance_m": search_m,
                            "stats_window": f"{quarter} {year}",
                            "cloud_threshold_%": cloud,
                            "buffer_m": buffer_m,
                            "scale_m": int(scale_m),
                            "simplify_m": simplify_m,
                        }
                        st.session_state[rkey] = base_payload

                        # 4) Compute whole-road stats (cached) and update payload
                        stats_dict = compute_road_stats_cached(
                            region_name=region_name,
                            road_class=road_class,
                            osm_id=str(osm_id),
                            year=year,
                            quarter=quarter,
                            cloud=cloud,
                            buffer_m=buffer_m,
                            scale_m=int(scale_m),
                            simplify_m=simplify_m,
                        )

                        if stats_dict:
                            st.session_state[rkey] = {
                                **base_payload,
                                "status": "Selected road (stats ready)",
                                "NDVI_mean": stats_dict.get("NDVI"),
                                "NDMI_mean": stats_dict.get("NDMI"),
                                "SWIR_NIR_mean": stats_dict.get("SWIR_NIR"),
                                "B4_mean (Red)": stats_dict.get("B4"),
                                "B8_mean (NIR)": stats_dict.get("B8"),
                                "B11_mean (SWIR1)": stats_dict.get("B11"),
                            }
                        else:
                            st.session_state[rkey] = {
                                **base_payload,
                                "status": "Selected road (stats failed)",
                                "warning": "Could not compute Sentinel stats for this road (try another road or increase Stats resolution).",
                            }

            except Exception as e:
                # Always show something in the panel
                st.session_state[rkey] = {
                    "status": "Error",
                    "error": str(e),
                }

