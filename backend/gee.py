# All Earth Engine (GEE) functions.
# - Initializes EE, builds composites, returns region geometry.
# - Creates tile URLs for map layers.
# - If you move away from Flask to another platform, you can reuse this file unchanged.

import functools
import ee
from backend import config

_initialized = False

def init_ee():
    global _initialized
    if not _initialized:
        ee.Initialize(project=config.EE_PROJECT)
        _initialized = True

def ee_tile_layer(image: ee.Image, vis: dict):
    m = image.getMapId(vis)
    return m["tile_fetcher"].url_format

def regions_fc_ghana():
    return ee.FeatureCollection(config.REGIONS_FC_ID).filter(ee.Filter.eq("NAM_0", "Ghana"))

@functools.lru_cache(maxsize=64)
def list_regions_ghana():
    init_ee()
    names = regions_fc_ghana().aggregate_array("NAM_1").distinct().sort().getInfo()
    return names if isinstance(names, list) else []

@functools.lru_cache(maxsize=128)
def region_geom_center(region_name: str):
    init_ee()
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

def roads_fc_for_geom(geom: ee.Geometry, classes, asset_id: str):
    init_ee()
    return (
        ee.FeatureCollection(asset_id)
        .filterBounds(geom)
        .filter(ee.Filter.inList("fclass", ee.List(classes)))
    )

def ee_fc_to_paint_image(fc: ee.FeatureCollection, color_hex: str, width: int = 2):
    img = ee.Image().byte().paint(featureCollection=fc, color=1, width=width)
    vis = {"min": 0, "max": 1, "palette": [color_hex.replace("#", "")]}
    return img.visualize(**vis)

@functools.lru_cache(maxsize=128)
def s2_composite_quarter_cached(year: int, quarter: str, region_name: str, cloud: int = 30):
    init_ee()
    region_geom, _ = region_geom_center(region_name)
    if region_geom is None:
        return None

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
        .select(["B2", "B3", "B4", "B8", "B11", "B12"])
    )

    return s2.median().clip(region_geom)

def s2_features(comp: ee.Image):
    # Indices
    ndvi = comp.normalizedDifference(["B8", "B4"]).rename("NDVI")
    ndmi = comp.normalizedDifference(["B8", "B11"]).rename("NDMI")
    ndbi = comp.normalizedDifference(["B11", "B8"]).rename("NDBI")
    ndwi = comp.normalizedDifference(["B3", "B8"]).rename("NDWI")
    bsi = (comp.select("B11").add(comp.select("B4"))
           .subtract(comp.select("B8").add(comp.select("B2")))
           .divide(comp.select("B11").add(comp.select("B4")).add(comp.select("B8")).add(comp.select("B2")))
           .rename("BSI"))
    swir_nir = comp.select("B11").divide(comp.select("B8")).rename("SWIR_NIR")

    return comp.addBands([ndvi, ndmi, ndbi, ndwi, bsi, swir_nir])
