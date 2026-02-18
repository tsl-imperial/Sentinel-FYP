import streamlit as st
import geopandas as gpd
import pandas as pd
from shapely.geometry import mapping, Point, box
from shapely import wkt as shapely_wkt
import ee
import folium
from streamlit_folium import st_folium
from pyproj import CRS

# -----------------------------
# Config
# -----------------------------
GEE_PROJECT = "sentinel-487715"
ROADS_SHP_PATH = "/Users/miranda/Documents/GitHub/Sentinel-FYP/data/ghana-260216-free.shp/gis_osm_roads_free_1.shp"

CLOUD_PCT = 20
START_DATE = "2023-01-01"
END_DATE = "2023-12-31"
BUFFER_M = 50

SIMPLIFY_TOL = 0.0002  # ~20–30m
GRID_ROWS = 3
GRID_COLS = 4

st.set_page_config(page_title="Ghana Road Quality Explorer", layout="wide")
st.title("Ghana Road Infrastructure Quality Explorer")

# -----------------------------
# Auth + Initialize GEE
# -----------------------------
@st.cache_resource
def init_ee():
    try:
        ee.Initialize(project=GEE_PROJECT)
    except Exception:
        ee.Authenticate()
        ee.Initialize(project=GEE_PROJECT)

init_ee()

# -----------------------------
# Load roads
# -----------------------------
@st.cache_data
def load_roads(path):
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    else:
        gdf = gdf.to_crs("EPSG:4326")
    gdf = gdf.reset_index(drop=True)
    return gdf

roads_gdf = load_roads(ROADS_SHP_PATH)

# Reduce payload size: keep only geometry + simplify
roads_gdf = roads_gdf[["geometry"]].copy()
roads_gdf["geometry"] = roads_gdf["geometry"].simplify(
    SIMPLIFY_TOL, preserve_topology=True
)

# -----------------------------
# Utility: add EE layer to Folium
# -----------------------------
def add_ee_layer(m, ee_object, vis_params, name):
    map_id = ee_object.getMapId(vis_params)
    folium.raster_layers.TileLayer(
        tiles=map_id["tile_fetcher"].url_format,
        attr="Google Earth Engine",
        name=name,
        overlay=True,
        control=True
    ).add_to(m)

# -----------------------------
# Compute buffer in meters (UTM)
# -----------------------------
def buffer_in_meters(geom_wgs84, buffer_m):
    centroid = geom_wgs84.centroid
    utm_zone = int((centroid.x + 180) / 6) + 1
    utm_crs = CRS.from_epsg(32600 + utm_zone)

    gdf = gpd.GeoDataFrame(geometry=[geom_wgs84], crs="EPSG:4326")
    gdf_utm = gdf.to_crs(utm_crs)
    buffered_utm = gdf_utm.buffer(buffer_m)
    buffered_wgs84 = buffered_utm.to_crs("EPSG:4326")
    return buffered_wgs84.iloc[0]

# -----------------------------
# GEE composites (cache once)
# -----------------------------
@st.cache_resource
def build_s2_composite():
    s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
          .filterDate(START_DATE, END_DATE)
          .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", CLOUD_PCT)))
    return s2.median()

def add_indices(image):
    b2 = image.select("B2")
    b3 = image.select("B3")
    b4 = image.select("B4")
    b8 = image.select("B8")
    b11 = image.select("B11")

    ndvi = image.normalizedDifference(["B8", "B4"]).rename("NDVI")
    ndwi = image.normalizedDifference(["B3", "B8"]).rename("NDWI")
    ndbi = image.normalizedDifference(["B11", "B8"]).rename("NDBI")

    bsi = (b11.add(b4).subtract(b8.add(b2))
           .divide(b11.add(b4).add(b8).add(b2))
           .rename("BSI"))

    brightness = (b2.add(b3).add(b4).add(b8)).divide(4).rename("BRIGHT")

    return image.addBands([ndvi, ndwi, ndbi, bsi, brightness])

S2_COMPOSITE = build_s2_composite()
S2_INDICES = add_indices(S2_COMPOSITE).select(["NDVI", "NDWI", "NDBI", "BSI", "BRIGHT"])

# -----------------------------
# GEE Feature Extraction (cached per road)
# -----------------------------
@st.cache_data
def gee_features_for_road_wkt(geom_wkt):
    geom = shapely_wkt.loads(geom_wkt)
    buffer_geom = buffer_in_meters(geom, BUFFER_M)
    ee_buffer = ee.Geometry(mapping(buffer_geom))

    stats = S2_INDICES.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=ee_buffer,
        scale=20,   # faster than 10m
        maxPixels=1e9
    )

    return stats.getInfo(), buffer_geom

# -----------------------------
# Grid for Ghana
# -----------------------------
@st.cache_data
def build_grid(bounds, rows, cols):
    minx, miny, maxx, maxy = bounds
    dx = (maxx - minx) / cols
    dy = (maxy - miny) / rows
    cells = []
    for r in range(rows):
        for c in range(cols):
            cell = box(
                minx + c * dx,
                miny + r * dy,
                minx + (c + 1) * dx,
                miny + (r + 1) * dy
            )
            cells.append({"cell_id": f"{r}-{c}", "geometry": cell})
    return gpd.GeoDataFrame(cells, crs="EPSG:4326")

ghana_bounds = roads_gdf.total_bounds
grid_gdf = build_grid(ghana_bounds, GRID_ROWS, GRID_COLS)

# -----------------------------
# Selection state
# -----------------------------
if "selected_idx" not in st.session_state:
    st.session_state.selected_idx = 0
if "active_cell_id" not in st.session_state:
    st.session_state.active_cell_id = None

# -----------------------------
# Map
# -----------------------------
m = folium.Map(location=[7.95, -1.02], zoom_start=7, tiles=None)

folium.TileLayer(
    tiles="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    attr="Google",
    name="Google Satellite",
    overlay=False,
    control=True
).add_to(m)

# Draw grid
folium.GeoJson(
    grid_gdf,
    name="Ghana Grid",
    style_function=lambda x: {
        "color": "#FFD60A" if x["properties"]["cell_id"] == st.session_state.active_cell_id else "#FF9F0A",
        "weight": 2,
        "fillOpacity": 0.08
    }
).add_to(m)

# If active cell, subset roads and zoom in
if st.session_state.active_cell_id:
    cell_geom = grid_gdf[grid_gdf["cell_id"] == st.session_state.active_cell_id].iloc[0].geometry
    roads_subset = roads_gdf[roads_gdf.intersects(cell_geom)]
    m.fit_bounds([[cell_geom.bounds[1], cell_geom.bounds[0]], [cell_geom.bounds[3], cell_geom.bounds[2]]])
else:
    roads_subset = roads_gdf

folium.GeoJson(
    roads_subset,
    name="OSM Roads",
    style_function=lambda x: {"color": "#C0C0C0", "weight": 1}
).add_to(m)

# Selected road
selected_road = roads_gdf.iloc[st.session_state.selected_idx]
selected_geom_wgs84 = selected_road.geometry

folium.GeoJson(
    selected_geom_wgs84,
    name="Selected Road",
    style_function=lambda x: {"color": "#FF3B30", "weight": 3}
).add_to(m)

# Buffer
buffer_geom_wgs84 = buffer_in_meters(selected_geom_wgs84, BUFFER_M)
folium.GeoJson(
    buffer_geom_wgs84,
    name="Road Buffer",
    style_function=lambda x: {"color": "#007AFF", "weight": 2, "fillOpacity": 0.1}
).add_to(m)

# Sentinel-2 RGB composite for context (global, cached)
add_ee_layer(m, S2_COMPOSITE, {"bands": ["B4", "B3", "B2"], "min": 0, "max": 3000}, "Sentinel-2 RGB")

folium.LayerControl().add_to(m)

st.subheader("Map")
map_event = st_folium(m, width=1200, height=600)

# Click handling
# Click handling (replace existing block)
if map_event and map_event.get("last_clicked"):
    click = map_event["last_clicked"]
    click_point = Point(click["lng"], click["lat"])

    # Always check if click is inside a grid cell
    clicked_cell_id = None
    for _, row in grid_gdf.iterrows():
        if row.geometry.contains(click_point):
            clicked_cell_id = row["cell_id"]
            break

    # If clicked a different cell, switch to it
    if clicked_cell_id and clicked_cell_id != st.session_state.active_cell_id:
        st.session_state.active_cell_id = clicked_cell_id
        st.rerun()
    elif clicked_cell_id == st.session_state.active_cell_id:
        # Same cell: select nearest road inside it
        cell_geom = grid_gdf[grid_gdf["cell_id"] == st.session_state.active_cell_id].iloc[0].geometry
        roads_subset = roads_gdf[roads_gdf.intersects(cell_geom)]

        if not roads_subset.empty:
            centroid = click_point
            utm_zone = int((centroid.x + 180) / 6) + 1
            utm_crs = CRS.from_epsg(32600 + utm_zone)

            roads_utm = roads_subset.to_crs(utm_crs)
            click_utm = gpd.GeoSeries([click_point], crs="EPSG:4326").to_crs(utm_crs).iloc[0]

            distances = roads_utm.geometry.distance(click_utm)
            closest_global_idx = int(distances.idxmin())
            st.session_state.selected_idx = closest_global_idx
            st.rerun()


# -----------------------------
# Features
# -----------------------------
st.subheader("Selected Road Features")

with st.spinner("Computing features from Sentinel-2..."):
    features, _ = gee_features_for_road_wkt(selected_geom_wgs84.wkt)

if features:
    df = pd.DataFrame.from_dict(features, orient="index", columns=["Mean Value"])
    st.dataframe(df, use_container_width=True)
else:
    st.warning("No features computed. Check date range or road geometry.")
