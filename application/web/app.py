# Flask backend (API only).
# - Exposes routes like /api/overview_layers, /api/road_stats.
# - Makes the logic available to any web UI.
# - If you switch to another frontend, keep these endpoints or re‑implement them.

from flask import Flask, jsonify, request, render_template
import os
import json
import pickle
from pathlib import Path
import ee
import geopandas as gpd
import osmnx as ox
from igraph import Graph
from shapely.geometry import Polygon, mapping
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

OUTPUT_DIR = Path("/Users/miranda/Documents/GitHub/Sentinel-FYP/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

@app.get("/")
def index():
    return render_template("index.html")

@app.get("/api/regions")
def regions():
    return jsonify(["Ghana"] + list_regions_ghana())

@app.get("/api/overview_layers")
def overview_layers():
    region = request.args.get("region", "").strip()
    layers = []
    if region and region != "Ghana":
        region_geom, _ = region_geom_center(region)
        if region_geom is None:
            return jsonify({"error": "region not found"}), 404
        target_geom = region_geom
    else:
        target_geom = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(
            ee.Filter.eq("country_na", "Ghana")
        ).geometry()

    for cls in config.TOP10:
        fc_cls = roads_fc_for_geom(target_geom, [cls], config.ROADS_ASSET)
        painted = ee_fc_to_paint_image(fc_cls, color_hex=config.CLASS_COLORS[cls], width=2).clip(target_geom)
        layers.append({
            "class": cls,
            "color": config.CLASS_COLORS[cls],
            "tile": ee_tile_layer(painted, {}),
        })
    return jsonify({"layers": layers})

@app.get("/api/region_info")
def region_info():
    region = request.args.get("region", "")
    if region == "Ghana":
        ghana_geom = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(
            ee.Filter.eq("country_na", "Ghana")
        ).geometry()
        cen = ghana_geom.centroid(1).coordinates().getInfo()
        return jsonify({"center": [cen[1], cen[0]]})
    geom, center = region_geom_center(region)
    if geom is None:
        return jsonify({"error": "region not found"}), 404
    return jsonify({"center": center})

@app.get("/api/roads_layer")
def roads_layer():
    region = request.args.get("region")
    road_class = request.args.get("class")

    if region == "Ghana":
        region_geom = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(
            ee.Filter.eq("country_na", "Ghana")
        ).geometry()
    else:
        region_geom, _ = region_geom_center(region)
        if region_geom is None:
            return jsonify({"error": "region not found"}), 404

    if road_class:
        classes = [road_class]
    else:
        classes = [
            "trunk",
            "primary",
            "secondary",
            "tertiary",
            "residential",
            "service",
            "unclassified",
            "busway"
        ]

    fc_cls = roads_fc_for_geom(region_geom, classes, config.ROADS_ASSET)
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


def quarter_to_dates(year: int, quarter: str):
    ranges = {
        "Q1": ("01-01", "03-31"),
        "Q2": ("04-01", "06-30"),
        "Q3": ("07-01", "09-30"),
        "Q4": ("10-01", "12-31"),
        "Jan–Mar": ("01-01", "03-31"),
        "Apr–Jun": ("04-01", "06-30"),
        "Jul–Sep": ("07-01", "09-30"),
        "Oct–Dec": ("10-01", "12-31"),
        "Jan-Mar": ("01-01", "03-31"),
        "Apr-Jun": ("04-01", "06-30"),
        "Jul-Sep": ("07-01", "09-30"),
        "Oct-Dec": ("10-01", "12-31"),
    }
    if quarter not in ranges:
        raise ValueError(f"Unsupported quarter: {quarter}")
    s, e = ranges[quarter]
    return f"{year}-{s}", f"{year}-{e}"


def build_igraph_payload(clipped_edges: gpd.GeoDataFrame, nodes_gdf: gpd.GeoDataFrame):
    edge_index_nodes = set(clipped_edges["u"].tolist()) | set(clipped_edges["v"].tolist())
    node_subset = nodes_gdf.loc[nodes_gdf.index.intersection(edge_index_nodes)].copy()
    node_ids = node_subset.index.tolist()
    node_id_to_idx = {nid: i for i, nid in enumerate(node_ids)}
    node_coords = [(float(pt.y), float(pt.x)) for pt in node_subset.geometry]

    ig = Graph(directed=True)
    ig.add_vertices(len(node_ids))
    ig.vs["node_id"] = [str(nid) for nid in node_ids]

    edges = []
    edge_attrs = []
    edge_geometries = []
    for _, row in clipped_edges.iterrows():
        u = row["u"]
        v = row["v"]
        if u not in node_id_to_idx or v not in node_id_to_idx:
            continue
        edges.append((node_id_to_idx[u], node_id_to_idx[v]))

        length_m = row.get("length", None)
        try:
            length_m = float(length_m) if length_m is not None else float("nan")
        except Exception:
            length_m = float("nan")

        edge_attrs.append({
            "highway": str(row.get("highway")) if row.get("highway") is not None else None,
            "name": str(row.get("name")) if row.get("name") is not None else None,
            "oneway": row.get("oneway"),
            "maxspeed": str(row.get("maxspeed")) if row.get("maxspeed") is not None else None,
            "length_m": length_m,
        })
        edge_geometries.append(row.geometry.wkt if row.geometry is not None else None)

    ig.add_edges(edges)
    ig.es["weight"] = [ea["length_m"] if ea["length_m"] == ea["length_m"] else 0.0 for ea in edge_attrs]

    total_road_km = sum([ea["length_m"] for ea in edge_attrs if ea["length_m"] == ea["length_m"]]) / 1000.0

    payload = {
        "igraph_graph": ig,
        "node_coords_latlon": node_coords,
        "node_id_to_index": node_id_to_idx,
        "edge_geometries_wkt": edge_geometries,
        "edge_attributes": edge_attrs,
    }
    return payload, total_road_km


@app.post("/api/export_polygon_network_s2")
def export_polygon_network_s2():
    data = request.get_json(silent=True) or {}
    coords = data.get("polygon", [])
    filename = (data.get("filename") or "").strip()
    year = int(data.get("year", 2023))
    quarter = data.get("quarter", "Q1")
    cloud = int(data.get("cloud", 30))
    scale_m = int(data.get("scale", 20))
    buffer_m = int(data.get("buffer", 12))

    if not filename:
        return jsonify({"error": "filename is required"}), 400
    safe_filename = "".join(ch for ch in filename if ch.isalnum() or ch in ("-", "_")).strip("_")
    if not safe_filename:
        return jsonify({"error": "invalid filename"}), 400

    if not isinstance(coords, list) or len(coords) < 3:
        return jsonify({"error": "polygon must contain at least 3 vertices"}), 400

    try:
        poly_coords = [(float(c[0]), float(c[1])) for c in coords]
        if poly_coords[0] != poly_coords[-1]:
            poly_coords.append(poly_coords[0])
        polygon = Polygon(poly_coords)
    except Exception as exc:
        return jsonify({"error": f"invalid polygon coordinates: {exc}"}), 400

    if not polygon.is_valid or polygon.area <= 0:
        return jsonify({"error": "invalid polygon geometry"}), 400

    centroid = polygon.centroid
    c_lat = float(centroid.y)
    c_lon = float(centroid.x)
    mapillary_url = f"https://www.mapillary.com/app/?lat={c_lat:.7f}&lng={c_lon:.7f}&z=17"
    google_street_view_url = (
        f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={c_lat:.7f},{c_lon:.7f}"
    )

    try:
        # Prefer polygon query to avoid bbox-order/version ambiguity and oversized requests.
        try:
            G = ox.graph_from_polygon(
                polygon,
                network_type="drive",
                simplify=True,
            )
        except TypeError:
            # Fallback for older versions/signatures.
            minx, miny, maxx, maxy = polygon.bounds
            G = ox.graph_from_bbox(
                north=maxy,
                south=miny,
                east=maxx,
                west=minx,
                network_type="drive",
                simplify=True,
            )
        nodes_gdf, edges_gdf = ox.graph_to_gdfs(G, nodes=True, edges=True, fill_edge_geometry=True)
    except Exception as exc:
        return jsonify({"error": f"osmnx download failed: {exc}"}), 500

    edges_gdf = edges_gdf.reset_index()
    poly_gdf = gpd.GeoDataFrame(geometry=[polygon], crs="EPSG:4326")
    edges_wgs84 = edges_gdf.to_crs("EPSG:4326")
    clipped_edges = gpd.clip(edges_wgs84, poly_gdf)
    if clipped_edges.empty:
        return jsonify({"error": "no drivable roads found inside polygon"}), 404

    # Keep geometry-safe columns for GeoJSON output.
    geojson_edges = clipped_edges.copy()
    for col in geojson_edges.columns:
        if col == "geometry":
            continue
        geojson_edges[col] = geojson_edges[col].astype(str)

    # Build igraph payload.
    payload, total_road_km = build_igraph_payload(clipped_edges, nodes_gdf)

    # Sentinel-2 mean features over buffered road corridor.
    try:
        roads_buffer = clipped_edges.to_crs("EPSG:3857").buffer(buffer_m).to_crs("EPSG:4326").unary_union
        ee_geom = ee.Geometry(mapping(roads_buffer))
        start_date, end_date = quarter_to_dates(year, quarter)

        s2 = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(ee_geom)
            .filterDate(start_date, end_date)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud))
            .select(["B2", "B3", "B4", "B8", "B11", "B12"])
        )
        comp = s2.median()
        if comp is None:
            raise RuntimeError("No Sentinel-2 data for selected settings")
        from application.logic.gee import s2_features
        feat_img = s2_features(comp)
        stats = feat_img.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=ee_geom,
            scale=scale_m,
            maxPixels=1e9,
            tileScale=4,
            bestEffort=True,
        ).getInfo()
    except Exception as exc:
        return jsonify({"error": f"Sentinel extraction failed: {exc}"}), 500

    # Persist outputs.
    pkl_path = OUTPUT_DIR / f"{safe_filename}_network.pkl"
    edges_path = OUTPUT_DIR / f"{safe_filename}_network_edges.geojson"
    s2_path = OUTPUT_DIR / f"{safe_filename}_sentinel_stats.json"

    with open(pkl_path, "wb") as f:
        pickle.dump(payload, f)
    geojson_edges.to_file(edges_path, driver="GeoJSON")
    with open(s2_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)

    return jsonify({
        "status": "ok",
        "links": {
            "mapillary": mapillary_url,
            "google_street_view": google_street_view_url,
            "centroid_lat": c_lat,
            "centroid_lon": c_lon,
        },
        "files": {
            "network_pickle": str(pkl_path),
            "edges_geojson": str(edges_path),
            "sentinel_stats_json": str(s2_path),
        },
        "summary": {
            "node_count": int(payload["igraph_graph"].vcount()),
            "edge_count": int(payload["igraph_graph"].ecount()),
            "total_road_km": round(float(total_road_km), 3),
            "year": year,
            "quarter": quarter,
            "cloud": cloud,
            "scale_m": scale_m,
            "buffer_m": buffer_m,
            "sentinel_mean": stats,
        },
    })
