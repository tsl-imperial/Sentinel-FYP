import geopandas as gpd
import subprocess
from pathlib import Path

# ---- paths ----
shp_path = Path("/Users/miranda/Documents/GitHub/Sentinel-FYP/data/gis_osm_roads_free_1.shp")
geojson_path = Path("/Users/miranda/Documents/GitHub/Sentinel-FYP/data/gis_osm_roads_free_1.geojson")

# ---- 1) read shapefile -> GeoDataFrame ----
gdf = gpd.read_file(shp_path).to_crs("EPSG:4326")

# ---- 2) write to GeoJSON ----
gdf.to_file(geojson_path, driver="GeoJSON")
print("Saved:", geojson_path)