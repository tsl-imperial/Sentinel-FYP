import ee
ee.Initialize(project="sentinel-487715")

roads = ee.FeatureCollection("projects/sentinel-487715/assets/ghana_roads")
regions = ee.FeatureCollection("projects/sat-io/open-datasets/WORLD-BANK/WBGAD/WB_GAD_ADM1") \
    .filter(ee.Filter.eq("NAM_0", "Ghana"))

# Spatial join: attach region polygon to each road
joined = ee.Join.saveFirst("reg").apply(
    primary=roads,
    secondary=regions,
    condition=ee.Filter.intersects(leftField=".geo", rightField=".geo")
)

# Keep only osm_id + region name
def add_region(f):
    reg = ee.Feature(f.get("reg"))
    return ee.Feature(None, {
        "osm_id": f.get("osm_id"),
        "region": ee.Algorithms.If(reg, reg.get("NAM_1"), None)
    })

lookup_fc = ee.FeatureCollection(joined).map(add_region)

task = ee.batch.Export.table.toDrive(
    collection=lookup_fc,
    description="roads_region_lookup",
    folder="GEE_Exports",
    fileNamePrefix="roads_region_lookup",
    fileFormat="CSV"
)
task.start()
print("Started export task:", task.id)
