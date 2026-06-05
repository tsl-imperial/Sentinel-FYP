# Project Explanation

This document explains the main notebooks, Python files and datasets in this repository. It is written as a project map: what each file does, what methodology it uses, what results it produced, and how those results should be interpreted.

Important writing note: this file is allowed to name notebooks because it is an internal explanation document. The dissertation itself should **not** be written as "notebook X does Y". In the report, the same work should be written as a formal methodology: data preparation, Layer 1 paved/unpaved modelling, Layer 2 condition modelling, validation, spatial application and limitations.

It does **not** explain the Excel files, as requested.

---

## Executive Summary

The project has two main modelling layers.

**Layer 1** is the mature Ghana model. It predicts whether roads are paved or unpaved using OpenStreetMap surface tags as labels and Sentinel-2 road-corridor features as predictors. The strongest Layer 1 methodology is:

- Sentinel-2 temporal road-corridor indices from 2017–2023.
- OSM functional road class (`fclass`) one-hot features.
- Road-network graph-neighbour features (shared-endpoint adjacency).
- Grouped cross-validation by road name / OSM identifier to reduce leakage.
- XGBoost as the strongest final classifier, with Random Forest and Logistic Regression as comparisons, and LightGBM added for additional benchmarking.
- A separate `fclass`-only baseline to prove the model is not just learning road hierarchy.
- Sentinel-1 tested as an ablation — it does not significantly improve Layer 1 under simple GRD backscatter features (Wilcoxon p = 0.59).

**Layer 2** is centred on World Bank/NIRTIMS Nigeria road survey data as the strongest available condition reference. Ghana manual labels are too sparse and visually interpreted for validated condition modelling. The dissertation methodology focuses on paved-only binary condition classification using Nigeria data and interprets Nigeria-to-Ghana transfer as exploratory.

---

## Data Assets

### `data/ghana-260415.osm.pbf`

The local OpenStreetMap PBF extract for Ghana.

Role:
- Provides road geometry via `pyrosm`.
- Provides OSM road identifiers, names, functional class, and surface tags.
- Surface tags are cleaned into paved/unpaved labels for Layer 1.
- Road names are used for GroupKFold validation groups.

Limitations:
- Surface tags are incomplete — only ~8–10% of roads carry a surface tag.
- Tagged roads skew toward formal urban streets and major highways, not a random national sample.
- OSM road segmentation means one real-world road can be split into many geometry rows, requiring grouped validation.

### `data/gis_osm_roads_free_1.shp`

The local Ghana OSM roads shapefile.

Important fields: `osm_id`, `fclass`, `name`, `ref`, `oneway`, `maxspeed`, `bridge`, `tunnel`, `geometry`.

Role:
- Used by the Network Inspector local backend.
- Used for regional summaries and map display.
- Converted to PMTiles for the frontend map.
- Joined to `roads_region_lookup.csv` for regional summaries.

Observed structure:
- Very large number of residential and service roads.
- Many missing names and reference values.
- Useful for spatial display and application logic; not sufficient for surface or condition modelling by itself.

### `data/roads_region_lookup.csv`

Maps road `osm_id` values to Ghana administrative regions. Created by `notebooks/get_roads_region.py` (GEE spatial join). Used in the Network Inspector backend and in `analysis2017_2023.ipynb` for regional analysis. Some roads do not match to a region.

### `data/ghana_parquet/year=*/`

The main cleaned Ghana Sentinel-2 dataset. One parquet file per year from 2017 to 2023.

Columns: `osm_id`, `fclass`, `quarter`, `NDVI`, `NDMI`, `NDBI`, `NDWI`, `BSI`.

Typical shape:
- 2017: 658,208 rows, 329,104 unique roads (one observation per road-quarter — only two quarters present for most roads).
- 2018–2023: ~1,316,416 rows per year, 329,104 unique roads (four quarters).
- After cleaning: ~6.4M rows, ~326,546 usable unique roads.

What it represents: each row is a road-quarter observation. Values are road-corridor mean spectral indices from Sentinel-2 quarterly median composites. The signal includes pavement, shoulder, vegetation, bare soil, built environment, and mixed pixels — not a direct pavement measurement.

### `data/ghana_q3_cloud40_parquet/year=*/`

Re-exported Ghana Q3 Sentinel-2 observations for 2020–2023 using a 40% cloud threshold (original dataset used 20%). Q3 is wet-season and cloud-heavy; the re-export improves coverage. Used by `build_parquet.ipynb` to replace original Q3 records for 2020–2023.

### `data/ghana_parquet_s1/year=*/`

Ghana Sentinel-2 + Sentinel-1 merged dataset. Columns add: `s1_vv_mean`, `s1_vh_mean`, `s1_vv_minus_vh_mean`, `s1_vv_std`, `s1_vh_std`, `s1_vv_minus_vh_std`. ~1,490,556 rows per year, ~372,639 unique road IDs (outer merge, so some rows have S1 but no S2). Used in `sentinel1.ipynb` and `layer1_s1.ipynb`.

### `data/nigeria_parquet/year=*/`

Nigeria Sentinel-2 dataset exported along World Bank/NIRTIMS RoadCondition geometries. Years 2020–2025. Columns include raw bands (B2, B3, B4, B8, B11, B12), indices (NDVI, NDMI, NDBI, NDWI, BSI), plus `ROADCODE`, `ROADCODE_N`, `ROADNAME`, `SEG_ID`, `SURFACECON`, `quarter`, `image_count`. ~63,812 rows per year, 4,573 unique road codes. Main satellite data source for Nigeria Layer 2 condition modelling.

### `data/nigeria_s1_parquet/year=*/`

Nigeria Sentinel-1 dataset, years 2020–2025. Columns include `VH_mean`, `VH_stdDev`, `VV_mean`, `VV_minus_VH_mean`, `VV_minus_VH_stdDev`, `VV_stdDev`, plus road identifiers and condition. Used in `nigeria_s1.ipynb`.

### `data/nirtims_2025_11_14/*.shp`

World Bank/NIRTIMS road survey shapefiles for Nigeria. Main layers:
- `RoadCondition.shp`: 15,953 records, 4,573 unique roads, condition labels (Excellent / Good / Fair / Poor / Very Poor).
- `RoadPavement.shp`: 14,793 records, 4,647 unique roads, pavement type and width.
- `RoadNetwork.shp`: 6,196 records, 6,148 unique roads, ~39,206.6 km total surveyed length.
- `ProblemAreas.shp`: 26,028 records, 3,107 unique roads. Erosion, waterlogging, landslide.
- `Culverts.shp`: 12,348 records, 2,681 unique roads.
- `RoadSideDrains.shp`: 11,727 records, 4,289 unique roads.
- `Bridges.shp`: bridge records used in early exploratory analysis.

Condition label construction:
- Three-class: Excellent/Good → `good`, Fair → `fair`, Poor/Very Poor → `poor`.
- Binary: Excellent/Good → `good`, Fair/Poor/Very Poor → `poor-risk`.

Overall condition distribution: Poor + Very Poor ~59% of records; Excellent + Good ~13.6%.

### `frontend/public/tiles/ghana_roads.pmtiles`

Vector-tile version of the Ghana roads shapefile, built by `scripts/build_tiles.py`. Used by the Next.js frontend map. Does not affect modelling.

---

## Notebook Explanations

### `notebooks/exportdata.ipynb`

Exports Sentinel-2 and Sentinel-1 features from Google Earth Engine. Contains five export cells:

**Ghana S2**: `COPERNICUS/S2_SR_HARMONIZED`, bands B2 B3 B4 B8 B11 B12, indices NDVI NDMI NDBI NDWI BSI. Quarterly median composites (Q1=Jan–Mar, Q2=Apr–Jun, Q3=Jul–Sep, Q4=Oct–Dec). Mean value reduced over each road feature. Original cloud threshold 20%; Q3 2020–2023 re-exported at 40% threshold.

**Nigeria S2**: Same collection and indices, exported along NIRTIMS RoadCondition geometries at scale 20 m. Uses SCL masking. Years 2020–2025.

**S1 (Ghana and Nigeria)**: `COPERNICUS/S1_GRD`, Interferometric Wide Swath, ascending orbit, VV+VH. Features: VV mean/std, VH mean/std, VV-minus-VH mean/std. Fixed ascending orbit pass for temporal consistency.

Interpretation: S1 exports are valid exploratory ablation data but do not implement coherence, incidence-angle filtering, or vehicle-effect filtering — they should not be treated as a complete SAR road-condition method.

---

### `notebooks/build_parquet.ipynb`

Converts raw GEE CSV exports into clean partitioned parquet datasets.

Ghana S2 process: reads `data/s2_2017_2019`, `data/ghana_s2_2020_2023`, `data/ghana_q3_cloud40_parquet`; infers year/quarter where missing; cleans road IDs; filters to 7 focus road classes; replaces Q3 2020–2023 with cloud-threshold-40 exports; writes one parquet partition per year to `data/ghana_parquet`.

Ghana S1 process: outer merges cleaned S2 with S1 exports on `osm_id`/`year`/`quarter`; writes `data/ghana_parquet_s1`. The outer merge is why some rows have S1 but no S2.

---

### `notebooks/analysis2017_2023.ipynb`

**This is the primary pre-modelling baseline analysis notebook.** It replaces the three earlier exploratory notebooks (`prelim_analysis.ipynb`, `temporal_analysis.ipynb`, `analysis2020_2023.ipynb`). All charts are designed for direct dissertation inclusion.

#### Structure

**Part 1 — Setup & Data Loading**

Loads all 7 year partitions (2017–2023) from `data/ghana_parquet`. Applies three-stage cleaning: drop rows with NaN in any index, drop rows where any index is outside [−1, 1], drop rows where any index is exactly zero (sensor no-data artefacts).

- Total rows loaded: 8,227,600 (2017: 658,208; 2018–2023: ~1,316,416 each)
- Rows after cleaning: 6,375,404 (22.5% removed — mostly out-of-range or all-zero rows)
- Unique roads with S2 coverage: 326,546 (all have valid OLS slopes across 2017–2023)
- Road class distribution: residential dominates (257,398 unique roads, ~78.8%), followed by service (35,627, ~10.9%) and unclassified (22,950, ~7.0%). Trunk (1,822), primary (1,597), secondary (2,397), and tertiary (4,755) together make up the remaining ~3.2% but represent the formal highway network.
- Region match: 99.4% of observations (via `roads_region_lookup.csv`), covering all 16 Ghana administrative regions.

**Figure 1**: Horizontal bar chart of unique OSM road segments per class.
**Figure 2**: Side-by-side heatmaps of (a) absolute unique road count per year × class and (b) coverage relative to class maximum (%). Shows 2017 has roughly half the observations of later years because only two quarters were available for most roads.

**Part 2 — Baseline Spectral Characterisation**

Descriptive statistics (mean ± std, median, IQR) computed for all 5 indices across all 7 classes, pooled across 2017–2023.

Key findings:
- Unclassified roads: highest mean NDVI (0.361 ± 0.179), lowest mean BSI (0.070 ± 0.125) — consistent with rural/vegetated surroundings far from urban centres.
- Service roads: lowest mean NDVI (0.181 ± 0.133), highest mean NDBI/BSI (NDBI 0.094, BSI 0.120) — consistent with dense urban/commercial contexts.
- Trunk and primary roads: intermediate NDVI (~0.191) and slightly lower BSI than service, consistent with mixed highway corridors.
- NDBI and NDWI are exact mirrors (NDBI = −NDWI by band construction: NDBI uses B11/B8, NDWI uses B3/B8 but the NDWI definition used here is the Gao variant which inverts the sign). Only one should enter any model to avoid perfect multicollinearity.
- Unclassified roads have the largest IQR across all indices, reflecting heterogeneous rural contexts.

**Figure 3**: 5-panel boxplots — one panel per index, all 7 classes, 2017–2023 pooled (no outliers shown). The definitive class-level spectral signature chart for the dissertation.
**Figure 4**: Pairwise correlation heatmap (500k sample). Confirms NDBI ≈ −NDWI and shows NDVI–BSI inverse relationship (~−0.6 correlation).
**Figure 5**: Stacked bar — road corridor context proxy (Urban-like / Mixed / Rural-Vegetated) by class. Derived from NDBI/NDVI thresholds at the 60th percentile. Trunk and primary have higher urban-like fractions; residential and unclassified skew rural/vegetated.

**Part 3 — Seasonal Patterns**

Quarterly means pooled across all years 2017–2023.

Key findings:
- NDVI peaks Q2–Q3 (Ghana's main wet season, April–September); BSI peaks Q1 (dry harmattan, December–March).
- Pattern is consistent across all road classes.
- Unclassified and tertiary roads show the largest NDVI seasonal amplitude — more vegetation-sensitive surroundings.
- Trunk and primary roads have the flattest seasonal profiles.

**Figure 6**: Side-by-side line plots of (a) NDVI seasonal cycle and (b) BSI seasonal cycle by road class, 2017–2023 pooled.
**Figure 7**: Side-by-side horizontal bar charts of NDVI and BSI seasonal amplitude (max − min quarterly mean) by class.

**Part 4 — Year-on-Year Trends**

Annual means per class and year-on-year deltas for all five indices.

Key findings:
- A systematic NDVI dip across all classes in 2018 is consistent with below-average rainfall that year.
- BSI drops broadly in 2019 following recovery from the 2018–2019 wet season.
- Unclassified roads show a rising NDVI trend over 2017–2023 (from ~0.30 in 2017 to ~0.39 in 2023) — possibly reflecting vegetation regrowth or land-use change along rural corridors.
- No monotonic multi-year degradation signal at class level — temporal structure is dominantly seasonal, not directionally degrading.

**Figure 8**: Line plot of annual mean NDVI per class, 2017–2023.
**Figure 9**: Side-by-side heatmaps of YoY NDVI delta and YoY BSI delta (class × year).

**Part 5 — Road-Level Temporal Features**

Per-road OLS linear trend slopes computed for NDVI and BSI over 2017–2023 using a vectorised closed-form formula (`t = year×4 + qnum` as the quarterly time index). Roads with fewer than 6 observations are excluded.

- Roads with valid slopes (≥6 observations): 326,546
- Degradation proxy flag: NDVI slope < 0 AND BSI slope > 0 (decreasing vegetation cover and increasing bare surface exposure over the period).
- Flagged proportions by class: residential 18.2%, primary 17.5%, tertiary 15.8%, service 14.7%, trunk 14.6%, secondary 13.9%, unclassified 9.4%.
- Residential roads have the highest absolute count of flagged segments (46,881) purely due to their dominance in the network; primary and trunk have the highest rates among highway classes, consistent with high-traffic corridors showing more bare-surface signal.
- These per-road temporal slopes feed directly into the Layer 1 and Layer 2 feature sets.

**Figure 10**: Side-by-side violin plots of per-road NDVI and BSI slope distributions by class (clipped to 2.5th–97.5th percentile for legibility).
**Figure 11**: Stacked bar chart of degradation signal proportion by class.

**Part 6 — Regional Analysis**

Roads merged with Ghana administrative regions via `data/roads_region_lookup.csv`. Uses 2023 snapshot for composition analysis; uses all years for NDVI trend analysis.

Key findings:
- Greater Accra and Ashanti have the lowest unpaved proxy fractions, reflecting urban density.
- Northern and Upper regions have higher informal/unclassified road shares.
- NDVI varies significantly across regions and years, reflecting agro-ecological zone differences (coastal, forest belt, savannah zones).
- Top 10 regions by road count show stable annual NDVI with year-specific anomalies matching the class-level pattern.

**Figure 12**: Stacked bar chart of road class composition by region (2023).
**Figure 13**: Horizontal bar chart of unpaved proxy fraction (residential + service + unclassified) by region.
**Figure 14**: Side-by-side heatmaps of (a) absolute annual mean NDVI and (b) YoY NDVI delta, top 10 regions by road count.

**Part 7 — Road Surface Analysis (OSM PBF)**

Loads the Geofabrik PBF extract using `pyrosm`, audits attribute coverage across all 330,102 focus-class road segments, inventories every surface tag value, builds paved/unpaved labels via direct tagging and named-road propagation, and compares Sentinel-2 spectral signals between surface types. The section is gated on `pyrosm` availability and skips gracefully if the package is not installed.

**OSM attribute coverage** (330,102 focus-class roads):

| Tag | Count | Coverage |
|-----|-------|----------|
| surface | 29,888 | 9.1% |
| maxspeed | 23,454 | 7.1% |
| name | 17,157 | 5.2% |
| lanes | 4,282 | 1.3% |
| smoothness | 2,460 | 0.7% |
| tracktype | 265 | 0.1% |

The `name` column (5.2%) is the key auxiliary attribute used by the propagation stage. The very low `smoothness` and `tracktype` coverage (~0.1–0.7%) rules both out as standalone label sources.

**Surface tag value inventory**: 30 distinct values appear in the dataset. Of these, 10 map to the paved category (asphalt, paved, concrete, concrete:plates, concrete:lanes, paving_stones, sett, cobblestone, metal, bricks, cement, chipseal, wood — the full canonical set), 14 map to unpaved (unpaved, ground, dirt, earth, gravel, fine_gravel, sand, mud, grass, compacted, pebblestone, soil, grass_paver, laterite, gravel;dirt, woodchips, track), and 6 fall into unmapped/ambiguous (e.g. `unknown`, `yes`). The top-3 values by frequency are `asphalt`, `unpaved`, and `gravel` — together accounting for the large majority of tagged roads.

**Label construction — two-stage pipeline**:

Stage 1 (direct surface tag): roads whose `surface` field falls in the paved or unpaved canonical sets. This yields 29,876 roads (9.1% of the focus-class network).

Stage 2 (named-road propagation): for each `name` group, collect all Stage 1 labeled members. If they unanimously agree on a single class (all paved or all unpaved) → the inferred label is applied to unlabeled roads sharing that name. If the name group contains both paved and unpaved members → no inference is made (ambiguous). This yielded 1,786 additional roads from 10,138 candidates.

| Stage | Roads | % of network |
|-------|-------|-------------|
| All focus-class roads | 330,102 | 100% |
| Have surface tag | 29,888 | 9.1% |
| Stage 1 — direct labels | 29,876 | 9.1% |
| Stage 2 — propagation candidates | 10,138 | 3.1% |
| Stage 2 — filled via propagation | 1,786 | 0.5% |
| **Final labeled pool** | **31,662** | **9.6%** |

Final split: **unpaved 17,290 (54.6%) / paved 14,372 (45.4%)**.

**Paved/unpaved by road class** (labeled subset only):

| Class | Paved | Unpaved | % Paved |
|-------|-------|---------|---------|
| trunk | 1,491 | 44 | 97.1% |
| primary | 1,087 | 75 | 93.5% |
| secondary | 1,509 | 169 | 89.9% |
| tertiary | 1,790 | 585 | 75.4% |
| service | 2,958 | 1,489 | 66.5% |
| residential | 4,406 | 9,672 | 31.3% |
| unclassified | 1,131 | 5,256 | 17.7% |

National highway classes (trunk, primary, secondary) are almost entirely paved, as expected. Residential and unclassified roads are predominantly unpaved, reflecting Ghana's informal road stock. Tertiary sits at a transitional 75/25 split. Service roads are 66.5% paved, skewed by their urban commercial concentration.

**Paved/unpaved by region** (labeled subset, ≥20 roads):

Greater Accra is the most paved region (71.7% paved), followed by Ashanti (59.1%). All remaining regions are majority-unpaved. The least-paved regions are Western North (7.8% paved), Savannah (8.0%), Upper East (20.3%), and Upper West (21.2%) — consistent with lower infrastructure investment in the northern savannah belt. The full ranking is: Western North (7.8%) < Savannah (8.0%) < Bono East (19.8%) < Upper East (20.3%) < Northern East (20.4%) < Upper West (21.2%) < Northern (25.2%) < Oti (26.2%) < Ahafo (26.4%) < Western (28.0%) < Volta (30.7%) < Central (30.8%) < Eastern (32.4%) < Bono (39.7%) < Ashanti (59.1%) < Greater Accra (71.7%).

**Spectral separation** (30,861 roads matched to S2 means; 13,835 paved, 17,026 unpaved):

All five indices show highly significant separation (Mann-Whitney, all p < 0.001):

| Index | Paved mean | Unpaved mean | Direction | p-value |
|-------|-----------|-------------|-----------|---------|
| NDVI | 0.1626 | 0.2869 | Unpaved > Paved | p ≈ 0 *** |
| NDMI | −0.0965 | −0.0634 | Unpaved > Paved | p = 3.8e-237 *** |
| NDBI | 0.0965 | 0.0634 | Paved > Unpaved | p = 3.8e-237 *** |
| NDWI | −0.2301 | −0.3554 | Paved > Unpaved | p ≈ 0 *** |
| BSI | 0.1204 | 0.1028 | Paved > Unpaved | p = 3.9e-21 *** |

NDVI is the strongest discriminator: unpaved roads average 0.287 vs paved 0.163 — a difference of 0.124, consistent with the more vegetated corridors of rural unpaved roads. NDBI (impervious surface proxy) is higher for paved, reflecting the built-up surroundings of formal paved streets. BSI is slightly higher for paved, consistent with the exposed mineral surface of asphalt/concrete reflecting similarly to bare soil in the B11/B4 bands. NDMI is less discriminatory than NDVI or NDBI, as canopy moisture is governed more by surrounding vegetation than pavement type alone.

These spectral differences — particularly the NDVI and NDBI/NDWI separation — are the physical basis for the Layer 1 paved/unpaved classification model, and explain why S2 features alone achieve macro-F1 ≈ 0.882.

**Figure 15**: Horizontal bar chart of OSM attribute coverage per tag (count + % of 330,102 focus-class roads), with surface highlighted in red.
**Figure 16**: Horizontal bar chart of the top-30 surface tag values by frequency, colour-coded green (paved), red (unpaved), grey (unmapped/ambiguous).
**Figure 17**: Label construction funnel — 6-stage horizontal bar chart from all focus roads down to the final labeled pool, broken down by direct tagging vs propagation.
**Figure 18**: Side-by-side: (a) paved vs unpaved absolute counts by road class; (b) paved/unpaved percentage share stacked bar by class.
**Figure 19**: Stacked horizontal bar chart of paved vs unpaved share by Ghana administrative region (labeled subset, ≥20 roads per region), sorted ascending by paved fraction.
**Figure 20**: 5-panel boxplots (one per S2 index) comparing paved vs unpaved road-corridor spectral values within each functional class (road-level mean, 2017–2023 pooled, OSM labeled subset).

---

### `notebooks/road_class_analysis.ipynb`

Explores the Ghana road network by OSM functional class and road attributes.

Important results:
- Residential roads dominate: 258,612 segments.
- Service: 36,318; Unclassified: 23,166; Tertiary: 4,929; Secondary: 2,516; Trunk: 1,887; Primary: 1,676.
- `name` missing: 358,145. `ref` missing: 369,190. `maxspeed == 0`: 347,377.

Interpretation: Ghana OSM geometry coverage is large but attribute completeness is weak. This supports the argument that OSM is useful but biased/incomplete, and why `fclass` is important but cannot be treated as sufficient by itself.

---

### `notebooks/sentinel1.ipynb`

Explores Sentinel-1 Ghana features and their relationship to Sentinel-2 and OSM surface labels.

Data: `data/ghana_parquet_s1`. Rows loaded: 10,433,892. Years: 2017–2023. S1 coverage is nearly complete across quarters; S2 coverage is much more variable due to cloud.

Paved/unpaved label coverage in S1 analysis: ~8.12% (13,336 paved, 17,131 unpaved, 301,209 missing).

Key results:
- Paved roads have lower NDVI and higher NDBI/BSI signals than unpaved roads (consistent with `analysis2017_2023.ipynb` Part 7).
- S1 VV/VH differences exist between paved and unpaved but are not clean enough to be a standalone condition model.
- Some S1 values spike at near-zero — possible missing/export artefacts that need careful filtering before serious S1 modelling.

Interpretation: S1 has coverage advantages but the simple GRD backscatter features are noisy. The notebook explains why S1 is an ablation rather than the final method.

---

### `notebooks/layer1.ipynb`

Builds the Layer 1 Ghana paved/unpaved model **without** OSM `fclass` as a feature. This is the pure satellite-only baseline.

Method: loads 2020 S2 features, extracts OSM surface labels from PBF, propagates labels via road name groups, builds multi-year (2017–2023) temporal features, adds enhanced temporal features, adds graph-neighbour features, benchmarks under GroupKFold.

Key results:

| Stage | Model | Accuracy | Macro-F1 |
|-------|-------|----------|----------|
| 2020 S2 baseline | Random Forest | 0.784 | 0.781 |
| Multi-year S2 | Random Forest | 0.847 | 0.844 |
| Enhanced temporal | Random Forest | 0.851 | 0.849 |
| + Graph neighbours | Random Forest | 0.858 | 0.855 |
| + Graph neighbours | XGBoost | 0.883 | 0.882 |

Interpretation: moving from one-year to multi-year features is the single largest improvement. XGBoost handles the road-level tabular features better than Random Forest. This notebook proves the model does not need `fclass` to perform reasonably well.

---

### `notebooks/testlayer1.ipynb`

Repeats the Layer 1 pipeline and adds OSM functional road class (`fclass`) as a predictor. Also adds LightGBM, permutation importance, SHAP analysis, and a Wilcoxon signed-rank test comparing Stage 2 (S2 + fclass) against Stage 1 (S2-only).

Key results:

| Stage | Model | Accuracy | Macro-F1 | MCC |
|-------|-------|----------|----------|-----|
| 2020 S2 + fclass | Random Forest | 0.838 | 0.835 | — |
| Multi-year + fclass | Random Forest | 0.881 | 0.879 | — |
| Enhanced temporal + fclass | Random Forest | 0.882 | 0.880 | — |
| Enhanced temporal + fclass | XGBoost | 0.885 | 0.884 | — |
| + Graph neighbours + fclass | XGBoost | 0.896 | 0.895 | — |

Grouped CV final benchmark (5-fold, mean ± std):
- XGBoost: accuracy 0.894, macro-F1 0.892, MCC 0.784, paved F1 0.880, unpaved F1 0.905.
- LightGBM: accuracy ~0.893, macro-F1 ~0.891 (similar to XGBoost).
- Random Forest: accuracy 0.873, macro-F1 0.871.
- Logistic Regression: accuracy 0.849, macro-F1 0.848.

Wilcoxon test (Stage 2 vs Stage 1):
- Stage 2 per-fold macro-F1: [0.8705, 0.8731, 0.8725, 0.8705, 0.8668].
- Stage 1 per-fold macro-F1: [0.8488, 0.8591, 0.8473, 0.8477, 0.8621].
- Mean delta: +0.0177. p-value: 0.0312.
- Interpretation: adding `fclass` gives a statistically significant improvement at p < 0.05.

Feature importance: `fclass_residential` and `fclass_trunk` are top features; S2 temporal features (especially NDWI and BSI variability across years) remain important — the model is not only learning road hierarchy.

Interpretation: this is the strongest Layer 1 notebook. The key incremental story is: S2-only works → fclass-only is weaker → S2 + fclass + graph is strongest.

---

### `notebooks/layer1_class.ipynb`

Tests whether OSM road class alone can predict paved/unpaved status, providing a lower-bound baseline.

Key results:
- 31,399 roads after filtering to those with S2 coverage.
- Class balance: unpaved 54.54%, paved 45.46%.
- All classifiers (Logistic Regression, Random Forest, XGBoost) converge to similar performance because the feature set is tiny and categorical.
- Best fclass-only macro-F1: **0.741**. Paved F1: 0.691. Unpaved F1: 0.790.
- Dummy-majority baseline macro-F1: 0.353.

Interpretation: road class is strongly predictive (trunk/primary → paved; residential/unclassified → unpaved), but fclass-only macro-F1 of 0.741 is much lower than the combined model's 0.892. Satellite and graph features add substantial information beyond road hierarchy.

---

### `notebooks/layer1_s1.ipynb`

Tests whether adding Sentinel-1 SAR features improves Layer 1 paved/unpaved classification. Adds LightGBM and a Wilcoxon test comparing Stage 3 (S2 + S1 + fclass) against Stage 1 (S2-only).

Key results:

Multi-year model results (before grouped CV):

| Stage | Model | Accuracy | Macro-F1 |
|-------|-------|----------|----------|
| 2020 S2 baseline | Random Forest | 0.798 | 0.796 |
| Multi-year S2+S1 | Random Forest | 0.854 | 0.852 |
| Enhanced temporal | Random Forest | 0.856 | 0.854 |
| + Graph neighbours | Random Forest | ~0.862 | ~0.860 |

Wilcoxon test (Stage 3 vs Stage 1):
- Stage 3 per-fold macro-F1: [0.8575, 0.8481, 0.8596, 0.8538, 0.8476].
- Stage 1 per-fold macro-F1: [0.8488, 0.8591, 0.8473, 0.8477, 0.8621].
- Mean delta: +0.0003. p-value: 0.5938.
- Interpretation: S1 does **not** significantly improve Layer 1. The near-zero delta and high p-value support the claim that simple GRD backscatter adds noise rather than useful signal.

S1 diagnostic: VV/VH distributions show a near-zero spike in some roads, suggesting missing/export artefacts. These rows need careful filtering before any serious S1 modelling.

---

### `notebooks/layer1_full_network_prediction.ipynb`

Applies the final Layer 1 model to the full Ghana road network (~326k roads with S2 coverage). Includes a comparison against fclass-only, regional prediction summaries, confidence analysis, and Moran's I spatial autocorrelation test.

Key results:

Training:
- S2 rows: 6,375,404. Unique roads with S2: 326,546.
- Feature table rows: 326,546. Feature count: 122.
- Training rows (labeled): 30,851. Unique groups: 25,365.

Validation (5-fold grouped CV, mean):
- Accuracy: 0.882. Macro-F1: 0.881. MCC: 0.762.
- Paved F1: 0.867. Unpaved F1: 0.895.
- Paved recall: 0.855. Unpaved recall: 0.905.

fclass-only comparison:
- fclass-only macro-F1: 0.738.
- Satellite model macro-F1: 0.881.
- Uplift: +0.143. Wilcoxon p-value: 0.0312 (statistically significant).

Full-network prediction (326,546 roads):
- Regional unpaved fractions: Bono East (96.9%), Savannah (95.3%), Bono (95.3%), Upper East (94.7%) have highest predicted unpaved fractions. Greater Accra and Ashanti are not shown at top because they have the lowest fractions.
- Low-confidence predictions (confidence < 0.6): highest rate in Greater Accra (9.6%) and Ashanti (13.6%) — urban mixed contexts are harder to classify.

Moran's I:
- Moran's I: 0.0988. E[I] under H0: −0.0667. p-value: 0.0560 (999 permutations).
- Interpretation: weak positive spatial autocorrelation, not statistically significant at p < 0.05 but close. Can be discussed as marginal evidence of clustering without overclaiming.

Reporting note: the key dissertation outputs from this notebook are the predicted paved/unpaved share across all Ghana roads with S2 coverage, the predicted surface mix by road class and region, and the Wilcoxon uplift over fclass-only.

---

### `notebooks/nigeria.ipynb`

Exploratory analysis of the Nigeria World Bank/NIRTIMS road survey data and early Sentinel-2 linkage.

Loads NIRTIMS shapefiles: RoadNetwork, RoadCondition, RoadPavement, ProblemAreas, Culverts, Bridges, RoadSideDrains.

Key dataset results:
- RoadNetwork: 6,196 records, 6,148 unique roads, ~39,206.6 km total.
- RoadCondition: 15,953 records, 4,573 unique roads.
- RoadPavement: 14,793 records, 4,647 unique roads.
- ProblemAreas: 26,028 records, 3,107 unique roads.
- Culverts: 12,348 records, 2,681 unique roads.
- RoadSideDrains: 11,727 records, 4,289 unique roads.

Condition findings:
- Poor + Very Poor: ~59% of condition records. Excellent + Good: ~13.6%.
- Pavement-condition relationship: earthen roads 58.7% poor/very poor; gravel 47.8%; asphalt concrete 25.6%.

Sentinel-2 match: 4,573 NIRTIMS condition roads → 4,570 with S2 data (99.9% match).

Survey features derived from ProblemAreas, Culverts, and RoadSideDrains and included in Layer 2 models: erosion flag, waterlogging flag, culvert count per road, culvert condition, drain type, drain condition. These represent the "survey" component in the satellite + survey model comparisons.

Interpretation: Nigeria provides a much stronger Layer 2 ground-truth setting than Ghana manual labels. Condition is imbalanced and realistic. Pavement type and condition are related but not identical, justifying paved-only condition modelling.

---

### `notebooks/nigeria_model.ipynb`

Main Layer 2 condition modelling notebook. The key notebook for the dissertation Layer 2 methodology.

Method: loads NIRTIMS RoadCondition, RoadPavement, RoadNetwork, ProblemAreas, Culverts, RoadSideDrains; builds dominant road-level condition labels; aggregates satellite and survey features to road level; runs GroupKFold CV; compares satellite-only, satellite + survey, survey-only across three-class and binary tasks; includes SMOTE experiments for class imbalance.

#### Three-class experiments (good / fair / poor)

Dataset: 4,570 roads with S2 + condition label. Good: 735 (16.1%). Fair: 1,484 (32.5%). Poor: 2,351 (51.4%).

| Experiment | Macro-F1 | Bal. Acc | MCC |
|-----------|----------|----------|-----|
| A: Satellite only (static S2) | 0.561 ± 0.010 | 0.549 | 0.357 |
| B: Satellite + survey | 0.631 ± 0.021 | 0.617 | 0.445 |
| C: Survey only | 0.581 ± 0.017 | 0.580 | 0.337 |
| E: Temporal S2 only | 0.578 ± 0.012 | 0.563 | — |
| F: Temporal S2 + survey | 0.628 ± 0.014 | 0.606 | — |

Paved-only three-class (977 roads, good 48.4%, fair 24%, poor 27.6%):
- D: Satellite only: macro-F1 0.531, balanced accuracy 0.532.
- Temporal S2 paved-only: slight improvement over static.

#### Binary experiments (good vs poor-risk)

Overall binary: good 735, poor-risk 3,835 (strongly imbalanced).

| Experiment | Macro-F1 | Bal. Acc |
|-----------|----------|----------|
| A-bin: Satellite only (original) | 0.646 | 0.618 |
| A-bin: Satellite only (+SMOTE) | 0.685 | 0.684 |
| B-bin: Satellite + survey | 0.761 | 0.722 |
| C-bin: Survey only | 0.762 | 0.743 |
| E-bin: Temporal S2 only (original) | 0.639 | 0.611 |
| E-bin: Temporal S2 only (+SMOTE) | 0.697 | 0.687 |

SMOTE consistently improves balanced accuracy by ~6–8 percentage points for the imbalanced overall binary task.

Most dissertation-relevant result: the paved-only binary experiments where the class imbalance is near-equal (good 48.4%, poor 51.6%). Static satellite paved-only binary: macro-F1 ~0.698, balanced accuracy ~0.699. This is the cleanest evidence that satellite features contain condition signal.

Classifiers compared: Random Forest, XGBoost, LightGBM (all produce similar results; RF reported as primary). Wilcoxon tests used to compare stages.

Interpretation: satellite features have real condition signal but struggle with the fair/poor boundary in three-class tasks. Combined satellite + survey performs best. Survey-only is not dramatically better than satellite-only, meaning satellite features are not redundant. The paved-only binary result at ~70% balanced accuracy is the most defensible Layer 2 claim.

---

### `notebooks/nigeria_s1.ipynb`

Tests whether Sentinel-1 SAR improves Nigeria condition modelling, using the same NIRTIMS labels as `nigeria_model.ipynb`.

Dataset: S1 raw rows: 382,872. Road-level feature table: 4,570 roads matching S2 + labels. S1 features: 37 (VV/VH mean/std, VV-minus-VH, by quarter). S2 features: 67. Survey features: 21.

Pavement type in model data: Earthen 3,302, Asphalt 791, Gravel 232, Surface Dressing 154, Concrete 32.

Three-class results by experiment (macro-F1):

| Experiment | Macro-F1 | Accuracy |
|-----------|----------|----------|
| S2 only | ~0.63 | 0.633 |
| S2 + S1 | ~0.63 | 0.635 |
| S2 + Survey | **0.635** | 0.679 |
| S2 + S1 + Survey | 0.631 | 0.672 |
| S1 + Survey | 0.622 | 0.665 |
| Survey only | 0.586 | 0.603 |
| S1 only | lowest | — |

Binary results: best experiment is Survey only (macro-F1 slightly higher than S2 + Survey). S2 + S1 (paved-only binary): macro-F1 0.727, balanced accuracy 0.727 — marginally better than S2 only (0.723).

Paved-only subset (977 roads, near-balanced binary): S2 only macro-F1 0.723, S2+S1 macro-F1 0.727. S1 adds marginal improvement on paved roads specifically.

SAR diagnostics: VV/VH distributions between condition classes show partial overlap; the physical mechanism (backscatter from pavement roughness) is plausible but not cleanly separable with simple GRD summary statistics.

Interpretation: S1 does not reliably improve over S2 for Nigeria condition modelling. This is consistent with the Ghana Layer 1 finding. S1 should be framed as an exploratory SAR extension and limitation/future-work area in the dissertation.

---

### `notebooks/nigeria_ghana.ipynb`

Compares Ghana and Nigeria Sentinel-2 feature spaces to assess transferability of the Nigeria condition model to Ghana.

Dataset: Ghana road-level rows: 326,546 (from full S2 parquet). Nigeria road-level rows: 4,570. Combined: 331,116. Features: NDVI, NDMI, NDBI, NDWI, BSI means, stds, min, max. Coverage variables (`n_quarters`, `n_years`) excluded from domain classifier because they reflect data construction rather than physical road properties.

Domain classifier results:
- Accuracy: 0.949. ROC-AUC: 0.966.
- Nigeria F1: 0.731. Ghana F1: 0.972.
- The two countries are highly separable in S2 feature space.

Feature space differences (top standardised mean differences): NDWI_max, NDVI_min, and NDMI-related features show the largest cross-country differences. This reflects genuine agro-ecological differences between Ghana's forest belt / savannah and Nigeria's survey road network locations.

Network composition comparison:
- Ghana OSM: residential 78.82%, service 10.91%, unclassified 7.03%.
- Nigeria NIRTIMS: earthen 72.91%, asphalt 17.37%, gravel 5.10%.

Interpretation: direct Nigeria-to-Ghana condition transfer is risky because the feature spaces are distinct and the road populations are drawn from different distributions. The Nigeria model should be used as evidence of potential, not as validated Ghana prediction. This notebook is critical for scientific honesty in the dissertation and belongs mainly in Discussion/limitations/future work.

---

### `notebooks/layer2.ipynb`

Early exploratory Ghana Layer 2 using manually labelled Ghana condition data (`data/named_roads.xlsx`). Uses a two-stage pipeline (unpaved → high risk by rule; paved-only condition model). Trains Random Forest under GroupKFold.

This notebook is **exploratory only**. It is not the main dissertation Layer 2 methodology. It is useful because it demonstrates why Ghana manual labels are insufficient: labels are visually interpreted, the labeled set is sparse and imbalanced, the `good` class is extremely small, and there is risk of circularity (visual satellite interpretation compared with satellite-derived features).

---

### `notebooks/layer2_new.ipynb`

Experimental Ghana Layer 2 hybrid condition-score notebook. Combines S1+S2 features with physics-motivated condition proxies (S1 smoothness, BSI bare-soil intrusion, NDVI vegetation encroachment, trend slopes). Blends a supervised Random Forest with a physics-prior probability score.

This notebook is **exploratory only** and should not be mentioned as a main dissertation result. The physics weights are not independently validated and the manual labels are too sparse.

---

## Python Files

### `notebooks/get_roads_region.py`

Creates `data/roads_region_lookup.csv` via GEE spatial join (Ghana roads asset intersected with World Bank GADM-style boundary asset). Utility script only.

### `notebooks/geodataframe.py`

Converts `data/gis_osm_roads_free_1.shp` to GeoJSON at EPSG:4326. Utility script only.

### `scripts/build_tiles.py`

Builds `frontend/public/tiles/ghana_roads.pmtiles` from the Ghana roads shapefile using tippecanoe. Minimum zoom 4, maximum zoom 12. Supports frontend performance only.

### `backend/config.py`

Central configuration for the Network Inspector backend. Contains GEE project/asset IDs, road classes, class colour palette.

### `backend/gee.py`

Earth Engine helper functions for the backend: `init_ee()`, `regions_fc_ghana()`, `region_geom_center()`, `roads_fc_for_geom()`, `s2_composite_quarter_cached()`, `s2_features()`. Mirrors the notebook S2 extraction logic for live interactive use.

### `backend/features.py`

Backend feature/statistics logic for the interactive road inspector. Functions: `adaptive_search_m()`, `nearest_road_feature()`, `compute_road_stats_cached()`. Builds a road buffer, creates a quarterly S2 composite, computes mean index values over the buffered road geometry. Not the offline modelling pipeline.

### `backend/local_data.py`

Local-data backend for the Network Inspector. Loads and caches Ghana roads shapefile, region lookup, and all Ghana S2 parquet. Serves region lists, region centres, convex-hull boundaries, road-level S2 index time series, and region summaries. Uses `@lru_cache` throughout. Key for app performance.

### `backend/app.py`

Flask API backend. Main endpoints: `/api/healthz`, `/api/regions`, `/api/road_indices`, `/api/class_palette`, `/api/road_stats`, `/api/regions/details`, `/api/exports`, `/api/export_polygon_network_s2`. The export endpoint downloads an OSM road network via OSMnx, clips to a user-drawn polygon, builds an igraph payload, and optionally computes S2 stats via GEE.

---

## How the Main Research Story Fits Together

1. Ghana has a large OSM road network but incomplete surface and condition labels.
2. `analysis2017_2023.ipynb` characterises the Sentinel-2 road-corridor dataset comprehensively: spectral signatures by class, seasonal patterns, year-on-year trends, road-level temporal features, regional variation, and the spectral basis for paved vs unpaved separation.
3. S2-only Layer 1 already performs well (macro-F1 0.882), proving satellite signal exists.
4. Adding OSM road class improves the model significantly (Wilcoxon p = 0.031, Δ = +0.018).
5. fclass-only is much weaker (macro-F1 0.741) than the combined model (0.892).
6. Graph-neighbour features add network context and push XGBoost to macro-F1 0.895.
7. Sentinel-1 does not significantly improve Layer 1 (Wilcoxon p = 0.594, Δ ≈ 0).
8. Full-network prediction covers 326,546 Ghana roads; satellite uplift over fclass-only is +0.143 (Wilcoxon p = 0.031); Moran's I = 0.099 (p = 0.056, marginal clustering).
9. Ghana condition labels are insufficient for validated Layer 2.
10. Nigeria NIRTIMS data provide the strongest available Layer 2 test. Paved-only binary satellite model: macro-F1 ~0.70–0.73, balanced accuracy ~0.70–0.73.
11. Nigeria-Ghana feature-space domain classifier achieves 0.949 accuracy — the two countries are not directly comparable, so transfer should be discussed only as exploratory.
12. Therefore the dissertation claims: validated Ghana surface screening, exploratory condition-risk evidence from Nigeria, and a clear need for Ghana field-condition labels.

---

## Current Dissertation Methodology Check

For Study Area / Data:
- Ghana is the primary application case; Nigeria is the external survey-label reference for condition modelling.
- `analysis2017_2023.ipynb` is the authoritative pre-modelling data characterisation. All charts from that notebook can go directly into the Data / Exploratory Analysis chapter.
- Sentinel-1 is included as an exploratory ablation; it does not improve results and should be presented as a limitation / future-work area.

For Layer 1:
- Main result: XGBoost + S2 temporal + fclass + graph, grouped CV, macro-F1 0.892.
- Supporting results: S2-only (0.882), fclass-only (0.741), Wilcoxon significance tests.
- Full-network spatial application in `layer1_full_network_prediction.ipynb`.

For Layer 2:
- Main result: Nigeria paved-only binary, satellite-only, balanced accuracy ~0.70–0.73.
- Supporting: satellite + survey outperforms satellite-only; survey-only is competitive with satellite in binary tasks; SMOTE helps for imbalanced overall binary.
- Transfer: Nigeria-Ghana domain gap confirmed; transfer is exploratory only.

For writing style: describe methods in research terms — feature extraction, label construction, ablation design, grouped validation, binary condition modelling, transferability limitations. Do not reference notebook names in the report text.
