// Frontend logic (JavaScript).
// - Calls the Flask endpoints.
// - Renders maps (Leaflet).
// - Handles clicks and displays stats.

async function fetchJSON(url) {
  const r = await fetch(url);
  return r.json();
}

function initMap(id, center=[7.95, -1.0], zoom=7) {
  const map = L.map(id).setView(center, zoom);

  // Normal basemap
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "© OSM / CARTO"
  }).addTo(map);

  return map;
}

async function loadRandomRoad(map2, region, roadClass, year, quarter, cloud, scale) {
  const url = `/api/random_road_stats?region=${encodeURIComponent(region)}&class=${roadClass}&year=${year}&quarter=${encodeURIComponent(quarter)}&cloud=${cloud}&buffer=12&scale=${scale}&simplify=25`;
  const data = await fetchJSON(url);

  if (data && data.geometry) {
    setSelectedRoad(map2, data.geometry);
  }
  setResults(data);
}

async function addOverviewLayers(map) {
  const data = await fetchJSON("/api/overview_layers");

  map._classLayers = {};

  const container = document.getElementById("map1-classes");
  container.innerHTML = "";

  data.layers.forEach(layer => {
    const tile = L.tileLayer(layer.tile, {
      attribution: "Google Earth Engine",
      opacity: 0.95
    }).addTo(map);

    map._classLayers[layer.class] = tile;

    const row = document.createElement("label");
    row.className = "map1-class";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.addEventListener("change", () => {
      if (cb.checked) {
        tile.addTo(map);
      } else {
        map.removeLayer(tile);
      }
    });

    const swatch = document.createElement("span");
    swatch.className = "map1-swatch";
    swatch.style.backgroundColor = layer.color;

    const text = document.createElement("span");
    text.textContent = layer.class;
    text.style.color = layer.color;
    text.style.fontWeight = "600";

    row.appendChild(cb);
    row.appendChild(swatch);
    row.appendChild(text);
    container.appendChild(row);
  });
}

function setResults(obj) {
  const clean = { ...obj };
  if (clean.geometry) delete clean.geometry;
  document.getElementById("results").textContent = JSON.stringify(clean, null, 2);
}

function setSelectedRoad(map2, geojson) {
  if (map2._selectedRoadLayer) {
    map2.removeLayer(map2._selectedRoadLayer);
  }
  if (!geojson) return;

  map2._selectedRoadLayer = L.geoJSON(geojson, {
    style: { color: "#ff0000", weight: 5, opacity: 1.0 }
  }).addTo(map2);
}

async function setMap2Layer(map2, region, roadClass) {
  const res = await fetchJSON(`/api/roads_layer?region=${encodeURIComponent(region)}&class=${encodeURIComponent(roadClass)}`);
  if (map2._roadsLayer) {
    map2.removeLayer(map2._roadsLayer);
  }
  map2._roadsLayer = L.tileLayer(res.tile, {
    attribution: "Google Earth Engine",
    opacity: 1.0
  }).addTo(map2);

  const info = await fetchJSON(`/api/region_info?region=${encodeURIComponent(region)}`);
  if (info.center) {
    map2.setView([info.center[0], info.center[1]], 10);
  }
}

async function addBoundary(map, region="Ghana") {
  const res = await fetchJSON(`/api/boundary_layer?region=${encodeURIComponent(region)}`);
  if (map._boundaryLayer) {
    map.removeLayer(map._boundaryLayer);
  }
  map._boundaryLayer = L.tileLayer(res.tile, {
    attribution: "Google Earth Engine",
    opacity: 1.0
  }).addTo(map);
}

function renderMetrics() {
  const metrics = [
    ["B2 (Blue)", "Water/atmosphere, haze and coastal features."],
    ["B3 (Green)", "Vegetation health, water, and urban surfaces."],
    ["B4 (Red)", "Vegetation absorption; useful for NDVI."],
    ["B8 (NIR)", "Vegetation reflectance, biomass."],
    ["B11 (SWIR1)", "Soil/moisture, built materials."],
    ["B12 (SWIR2)", "Moisture and burn/soil discrimination."],
    ["NDVI", "Vegetation greenness (higher = more vegetation)."],
    ["NDMI", "Moisture content (higher = wetter)."],
    ["NDBI", "Built‑up surfaces (higher = more built‑up)."],
    ["NDWI", "Water/wetness signal."],
    ["BSI", "Bare soil index (higher = more exposed soil)."],
    ["SWIR_NIR", "Moisture/material proxy (higher = drier/soil)."]
  ];

  const el = document.getElementById("metrics");
  el.innerHTML = metrics.map(m => `<div><b>${m[0]}</b>: ${m[1]}</div>`).join("");
}

async function main() {
  const regionSel = document.getElementById("region");
  const roadClassSel = document.getElementById("road_class");
  const yearEl = document.getElementById("year");
  const quarterEl = document.getElementById("quarter");
  const cloudEl = document.getElementById("cloud");
  const scaleEl = document.getElementById("scale");

  const regions = await fetchJSON("/api/regions");
  regions.forEach(r => {
    const opt = document.createElement("option");
    opt.value = r; opt.textContent = r;
    regionSel.appendChild(opt);
  });

  ["residential","primary","secondary","trunk","tertiary","unclassified"].forEach(c=>{
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c;
    roadClassSel.appendChild(opt);
  });

  const map1 = initMap("map1");
  await addOverviewLayers(map1);
  await addBoundary(map1, "Ghana");

  const map2 = initMap("map2", [5.6, -0.2], 10);
  await setMap2Layer(map2, regionSel.value, roadClassSel.value);
  await addBoundary(map2, regionSel.value);

  // Load a random road immediately
  await loadRandomRoad(
    map2,
    regionSel.value,
    roadClassSel.value,
    yearEl.value,
    quarterEl.value,
    cloudEl.value,
    scaleEl.value
  );

  regionSel.addEventListener("change", async () => {
    await setMap2Layer(map2, regionSel.value, roadClassSel.value);
    await addBoundary(map2, regionSel.value);
    await loadRandomRoad(
      map2,
      regionSel.value,
      roadClassSel.value,
      yearEl.value,
      quarterEl.value,
      cloudEl.value,
      scaleEl.value
    );
  });

  roadClassSel.addEventListener("change", async () => {
    await setMap2Layer(map2, regionSel.value, roadClassSel.value);
    await loadRandomRoad(
      map2,
      regionSel.value,
      roadClassSel.value,
      yearEl.value,
      quarterEl.value,
      cloudEl.value,
      scaleEl.value
    );
  });

  map2.on("click", async (e) => {
    const region = regionSel.value;
    const roadClass = roadClassSel.value;
    const year = yearEl.value;
    const quarter = quarterEl.value;
    const cloud = cloudEl.value;
    const scale = scaleEl.value;

    const url = `/api/road_stats?region=${encodeURIComponent(region)}&class=${roadClass}&lon=${e.latlng.lng}&lat=${e.latlng.lat}&year=${year}&quarter=${encodeURIComponent(quarter)}&cloud=${cloud}&buffer=12&scale=${scale}&simplify=25`;
    const data = await fetchJSON(url);

    if (data && data.geometry) {
      setSelectedRoad(map2, data.geometry);
    }
    setResults(data);
  });

  renderMetrics();
}

main();
