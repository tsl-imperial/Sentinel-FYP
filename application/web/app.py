# Flask backend (API only).
# - Exposes routes like /api/overview_layers, /api/road_stats.
# - Makes the logic available to any web UI.
# - If you switch to another frontend, keep these endpoints or re‑implement them.

from flask import Flask, jsonify, request, render_template
import ee
from application import config
from application.logic import (
    init_ee,
    ee_tile_layer,
    list_regions_ghana,
    region_geom_center,
    roads_fc_for_geom,
    ee_fc_to_paint_image,
)
from application.logic.features import (
    adaptive_search_m,
    nearest_road_feature,
    compute_road_stats_cached,
)

app = Flask(__name__, template_folder="templates", static_folder="static")
init_ee()

@app.get("/")
def index():
    return render_template("index.html")

@app.get("/api/regions")
def regions():
    return jsonify(list_regions_ghana())

@app.get("/api/overview_layers")
def overview_layers():
    layers = []
    ghana_geom = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(
        ee.Filter.eq("country_na", "Ghana")
    ).geometry()

    for cls in config.TOP10:
        fc_cls = roads_fc_for_geom(ghana_geom, [cls], config.ROADS_ASSET)
        painted = ee_fc_to_paint_image(fc_cls, color_hex=config.CLASS_COLORS[cls], width=2).clip(ghana_geom)
        layers.append({
            "class": cls,
            "color": config.CLASS_COLORS[cls],
            "tile": ee_tile_layer(painted, {}),
        })
    return jsonify({"layers": layers})

@app.get("/api/region_info")
def region_info():
    region = request.args.get("region", "")
    geom, center = region_geom_center(region)
    if geom is None:
        return jsonify({"error": "region not found"}), 404
    return jsonify({"center": center})

@app.get("/api/roads_layer")
def roads_layer():
    region = request.args.get("region")
    road_class = request.args.get("class")

    region_geom, _ = region_geom_center(region)
    if region_geom is None:
        return jsonify({"error": "region not found"}), 404

    fc_cls = roads_fc_for_geom(region_geom, [road_class], config.ROADS_ASSET)
    roads_img = ee_fc_to_paint_image(fc_cls, color_hex="#1f77b4", width=2).clip(region_geom)
    roads_url = ee_tile_layer(roads_img, {})
    return jsonify({"tile": roads_url})

@app.get("/api/road_stats")
def road_stats():
    region = request.args.get("region")
    road_class = request.args.get("class")
    lon = float(request.args.get("lon"))
    lat = float(request.args.get("lat"))
    year = int(request.args.get("year"))
    quarter = request.args.get("quarter")
    cloud = int(request.args.get("cloud"))
    buffer_m = int(request.args.get("buffer", 12))
    scale_m = int(request.args.get("scale", 20))
    simplify_m = int(request.args.get("simplify", 25))

    region_geom, _ = region_geom_center(region)
    if region_geom is None:
        return jsonify({"error": "region not found"}), 404

    search_m = adaptive_search_m(None)

    nearest = nearest_road_feature(region_geom, road_class, lon, lat, search_m=search_m, asset_id=config.ROADS_ASSET)
    nearest_info = nearest.getInfo() if nearest is not None else None
    if not nearest_info or not nearest_info.get("properties"):
        return jsonify({"status": "No road found", "search_tolerance_m": search_m})

    props = nearest_info["properties"]
    osm_id = props.get("osm_id") or props.get("id") or props.get("osmID")

    stats = compute_road_stats_cached(
        region_name=region,
        road_class=road_class,
        osm_id=str(osm_id),
        year=year,
        quarter=quarter,
        cloud=cloud,
        buffer_m=buffer_m,
        scale_m=scale_m,
        simplify_m=simplify_m,
        asset_id=config.ROADS_ASSET,
    )

    return jsonify({
        "status": "ok",
        "osm_id": osm_id,
        "fclass": props.get("fclass"),
        "name": props.get("name"),
        "dist_m": props.get("dist_m"),
        "stats": stats,
        "geometry": nearest_info.get("geometry"),
    })

@app.get("/api/boundary_layer")
def boundary_layer():
    region = request.args.get("region", "Ghana")

    if region == "Ghana":
        geom = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(
            ee.Filter.eq("country_na", "Ghana")
        ).geometry()
    else:
        geom, _ = region_geom_center(region)
        if geom is None:
            return jsonify({"error": "region not found"}), 404

    outline_img = (
        ee.Image()
        .byte()
        .paint(ee.FeatureCollection(geom), 1, 3)
        .visualize(min=0, max=1, palette=["FFD000"])
    )
    outline_url = ee_tile_layer(outline_img, {})
    return jsonify({"tile": outline_url})


@app.get("/api/random_road_stats")
def random_road_stats():
    region = request.args.get("region")
    road_class = request.args.get("class")
    year = int(request.args.get("year"))
    quarter = request.args.get("quarter")
    cloud = int(request.args.get("cloud"))
    buffer_m = int(request.args.get("buffer", 12))
    scale_m = int(request.args.get("scale", 20))
    simplify_m = int(request.args.get("simplify", 25))

    region_geom, _ = region_geom_center(region)
    if region_geom is None:
        return jsonify({"error": "region not found"}), 404

    # random feature from class in region
    fc = roads_fc_for_geom(region_geom, [road_class], config.ROADS_ASSET).randomColumn("rand")
    road = ee.Feature(fc.sort("rand").first())
    info = road.getInfo()
    if not info or not info.get("properties"):
        return jsonify({"status": "No road found"})

    props = info["properties"]
    osm_id = props.get("osm_id") or props.get("id") or props.get("osmID")

    stats = compute_road_stats_cached(
        region_name=region,
        road_class=road_class,
        osm_id=str(osm_id),
        year=year,
        quarter=quarter,
        cloud=cloud,
        buffer_m=buffer_m,
        scale_m=scale_m,
        simplify_m=simplify_m,
        asset_id=config.ROADS_ASSET,
    )

    return jsonify({
        "status": "ok",
        "osm_id": osm_id,
        "fclass": props.get("fclass"),
        "name": props.get("name"),
        "stats": stats,
        "geometry": info.get("geometry"),
    })
