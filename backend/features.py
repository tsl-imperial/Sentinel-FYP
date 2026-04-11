#Analytics/business logic.
# - Finds nearest road, computes Sentinel‑2 statistics on a road buffer.
# - Contains core rules and caching.
# - This is the engine you reuse in any new application.

import ee
import functools
from backend import gee

def adaptive_search_m(zoom: int | None) -> int:
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

def nearest_road_feature(region_geom: ee.Geometry, road_class: str, lon: float, lat: float, search_m: int, asset_id: str):
    pt = ee.Geometry.Point([lon, lat])
    buf = pt.buffer(search_m)

    roads = gee.roads_fc_for_geom(region_geom, [road_class], asset_id).filterBounds(buf)

    def add_dist(f):
        return f.set("dist_m", f.geometry().distance(pt))

    return ee.Feature(roads.map(add_dist).sort("dist_m").first())

@functools.lru_cache(maxsize=512)
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
    asset_id: str,
):
    region_geom, _ = gee.region_geom_center(region_name)
    if region_geom is None:
        return None

    road_fc = (
        gee.roads_fc_for_geom(region_geom, [road_class], asset_id)
        .filter(ee.Filter.eq("osm_id", osm_id))
    )
    if road_fc.size().getInfo() == 0:
        road_fc = gee.roads_fc_for_geom(region_geom, [road_class], asset_id).filter(ee.Filter.eq("id", osm_id))
        if road_fc.size().getInfo() == 0:
            return None

    road = ee.Feature(road_fc.first())

    comp = gee.s2_composite_quarter_cached(year, quarter, region_name, cloud=cloud)
    if comp is None:
        return None

    feat_img = gee.s2_features(comp)
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
