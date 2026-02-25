# Central configuration.
# - Holds asset IDs, road classes, and colors.
# - Change this if you switch datasets, assets, or class definitions.
# - Keeps constants out of the logic/UI.

import os

EE_PROJECT = os.environ.get("EE_PROJECT", "sentinel-487715")

ROADS_ASSET = "projects/sentinel-487715/assets/ghana_roads"
ROADS_RECLASS_ASSET = "projects/sentinel-487715/assets/roads_reclassified"
REGIONS_FC_ID = "projects/sat-io/open-datasets/WORLD-BANK/WBGAD/WB_GAD_ADM1"

TOP10 = [
    "residential", "service", "unclassified", "path", "track",
    "tertiary", "footway", "secondary", "trunk", "primary",
]

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
    "primary": "#2F2F2F",
}
