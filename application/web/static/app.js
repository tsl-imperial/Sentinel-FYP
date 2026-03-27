// Frontend logic (JavaScript)
// - Single operational map
// - Region-scoped class overlays (visual toggles)
// - Polygon draw + network/S2 export

async function fetchJSON(url, options = {}) {
  const r = await fetch(url, options);
  const payload = await r.json();
  if (!r.ok) {
    throw new Error(payload.error || `Request failed (${r.status})`);
  }
  return payload;
}

function initMap(id, center = [7.95, -1.0], zoom = 7, opts = {}) {
  const map = L.map(id, opts).setView(center, zoom);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "© OSM / CARTO",
  }).addTo(map);
  return map;
}

let indicesChart = null;

function setKpi(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value ?? "-";
}

function renderIndicesChart(statsObj) {
  const canvas = document.getElementById("indicesChart");
  if (!canvas) return;

  const labels = ["NDVI", "NDMI", "NDBI", "NDWI", "BSI"];
  const values = labels.map((k) => {
    const v = statsObj?.[k];
    return Number.isFinite(Number(v)) ? Number(v) : null;
  });

  if (indicesChart) {
    indicesChart.destroy();
    indicesChart = null;
  }

  indicesChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Sentinel-2 mean indices",
        data: values,
        backgroundColor: ["#56b4ff", "#27c7b8", "#f59e0b", "#ef4444", "#a78bfa"],
        borderRadius: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: "#cfe0ff" },
          grid: { color: "rgba(180, 200, 240, 0.15)" },
        },
        y: {
          ticks: { color: "#cfe0ff" },
          grid: { color: "rgba(180, 200, 240, 0.15)" },
        },
      },
    },
  });
}

function setStreetViewLinks(obj) {
  const el = document.getElementById("street-view-links");
  if (!el) return;
  const links = obj?.links || {};
  if (!links.mapillary && !links.google_street_view) {
    el.innerHTML = "";
    return;
  }

  const items = [];
  if (links.mapillary) {
    items.push(
      `<a href="${links.mapillary}" target="_blank" rel="noopener noreferrer">Open Mapillary at polygon centroid</a>`
    );
  }
  if (links.google_street_view) {
    items.push(
      `<a href="${links.google_street_view}" target="_blank" rel="noopener noreferrer">Open Google Street View at polygon centroid</a>`
    );
  }
  el.innerHTML = items.join(" • ");
}

function summarizeResult(obj) {
  if (!obj) return "No results available yet.";
  if (obj.status === "processing") return "Running extraction in backend. This can take a while for larger polygons.";
  if (obj.status === "error" || obj.error) return `Extraction failed: ${obj.error || "unknown error"}`;
  if (obj.status === "polygon_cleared") return "Polygon cleared. Draw a new polygon to run extraction.";
  if (obj.status === "region_changed") return "Region updated and polygon reset. Draw a polygon to continue.";
  if (obj.status === "ready") return "Ready. Draw a polygon and click download to extract drivable roads + Sentinel-2 stats.";

  const s = obj.summary || {};
  const roadKm = Number.isFinite(Number(s.total_road_km)) ? Number(s.total_road_km).toFixed(2) : "-";
  const edges = s.edge_count ?? "-";
  const nodes = s.node_count ?? "-";
  const region = obj.region || "-";
  const year = s.year ?? obj.year ?? "-";
  const quarter = s.quarter ?? obj.quarter ?? "-";
  return `Completed for ${region} (${year} ${quarter}). Extracted ${roadKm} km across ${edges} edges / ${nodes} nodes.`;
}

function setResults(obj) {
  document.getElementById("results").textContent = JSON.stringify(obj, null, 2);
  const summaryEl = document.getElementById("result-summary");
  if (summaryEl) summaryEl.textContent = summarizeResult(obj);
  setStreetViewLinks(obj);

  const summary = obj?.summary || {};
  setKpi("kpi-road-km", summary.total_road_km ?? "-");
  setKpi("kpi-nodes", summary.node_count ?? "-");
  setKpi("kpi-edges", summary.edge_count ?? "-");

  const stats = summary.sentinel_mean || obj?.stats || {};
  renderIndicesChart(stats);
}

function renderMetrics() {
  const metrics = [
    ["B2 (Blue)", "Water/atmosphere, haze and coastal features."],
    ["B3 (Green)", "Vegetation health, water, and urban surfaces."],
    ["B4 (Red)", "Vegetation absorption; useful for NDVI."],
    ["B8 (NIR)", "Vegetation reflectance, biomass."],
    ["B11 (SWIR1)", "Soil/moisture, built materials."],
    ["B12 (SWIR2)", "Moisture and burn/soil discrimination."],
    ["NDVI", "Vegetation greenness (higher = denser/greener vegetation)."],
    ["NDMI", "Moisture content proxy (higher = wetter)."],
    ["NDBI", "Built-up surfaces proxy (higher = more built-up)."],
    ["NDWI", "Water/wetness signal."],
    ["BSI", "Bare soil signal (higher = more exposed soil)."],
    ["SWIR_NIR", "Moisture/material proxy (higher = drier/soil)."],
  ];

  const el = document.getElementById("metrics");
  el.innerHTML = metrics.map((m) => `<div><b>${m[0]}</b>: ${m[1]}</div>`).join("");
}

function createPolygonDrawController(map) {
  const state = {
    points: [],
    markers: [],
    line: null,
    polygon: null,
    closed: false,
  };

  const clear = () => {
    state.points = [];
    state.closed = false;
    state.markers.forEach((m) => map.removeLayer(m));
    state.markers = [];
    if (state.line) map.removeLayer(state.line);
    if (state.polygon) map.removeLayer(state.polygon);
    state.line = null;
    state.polygon = null;
  };

  const redraw = () => {
    if (state.line) map.removeLayer(state.line);
    if (state.polygon) map.removeLayer(state.polygon);

    if (state.closed && state.points.length >= 3) {
      state.polygon = L.polygon(state.points, {
        color: "#FF3B30",
        weight: 2,
        fillOpacity: 0.15,
      }).addTo(map);
    } else if (state.points.length >= 2) {
      state.line = L.polyline(state.points, { color: "#FF3B30", weight: 2 }).addTo(map);
    }
  };

  const close = () => {
    if (state.points.length < 3 || state.closed) return;
    state.closed = true;
    redraw();
  };

  const addPoint = (latlng) => {
    if (state.closed) return;
    state.points.push(latlng);
    const idx = state.points.length - 1;

    const marker = L.circleMarker(latlng, {
      radius: 5,
      color: "#FF3B30",
      fillColor: "#FF3B30",
      fillOpacity: 1,
      weight: 1,
    }).addTo(map);

    if (idx === 0) {
      marker.on("click", () => close());
    }

    state.markers.push(marker);
    redraw();
  };

  map.on("click", (e) => addPoint(e.latlng));
  map.on("dblclick", (e) => {
    L.DomEvent.stop(e);
    close();
  });

  return {
    clear,
    close,
    isClosed: () => state.closed,
    getLngLatPolygon: () => state.points.map((p) => [p.lng, p.lat]),
  };
}

function createClassLayerManager(map) {
  const state = {
    layerByClass: {},
    enabledByClass: {},
    legendControl: null,
    legendContainer: null,
  };

  function clearLayers() {
    Object.values(state.layerByClass).forEach((layer) => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    });
    state.layerByClass = {};
  }

  function ensureLegendControl() {
    if (state.legendControl) return;
    state.legendControl = L.control({ position: "bottomright" });
    state.legendControl.onAdd = () => {
      const div = L.DomUtil.create("div", "map-legend");
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      div.innerHTML = '<div class="map-legend-title">Road Classes</div><div id="map-legend-rows"></div>';
      state.legendContainer = div.querySelector("#map-legend-rows");
      return div;
    };
    state.legendControl.addTo(map);
  }

  function buildControls(layers) {
    ensureLegendControl();
    const container = state.legendContainer;
    if (!container) return;
    container.innerHTML = "";

    layers.forEach((layer) => {
      if (!(layer.class in state.enabledByClass)) {
        state.enabledByClass[layer.class] = true;
      }

      const row = document.createElement("label");
      row.className = "map1-class";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!state.enabledByClass[layer.class];

      cb.addEventListener("change", () => {
        state.enabledByClass[layer.class] = cb.checked;
        const tile = state.layerByClass[layer.class];
        if (!tile) return;
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
      text.style.fontWeight = "700";

      row.appendChild(cb);
      row.appendChild(swatch);
      row.appendChild(text);
      container.appendChild(row);
    });
  }

  async function loadForRegion(region) {
    clearLayers();

    const q = region ? `?region=${encodeURIComponent(region)}` : "";
    const data = await fetchJSON(`/api/overview_layers${q}`);

    data.layers.forEach((layerInfo) => {
      const tile = L.tileLayer(layerInfo.tile, {
        attribution: "Google Earth Engine",
        opacity: 0.95,
      });

      state.layerByClass[layerInfo.class] = tile;

      if (state.enabledByClass[layerInfo.class] !== false) {
        tile.addTo(map);
      }
    });

    buildControls(data.layers);
  }

  return { loadForRegion };
}

async function addBoundary(map, region = "Ghana") {
  const res = await fetchJSON(`/api/boundary_layer?region=${encodeURIComponent(region)}`);
  if (map._boundaryLayer) {
    map.removeLayer(map._boundaryLayer);
  }
  map._boundaryLayer = L.tileLayer(res.tile, {
    attribution: "Google Earth Engine",
    opacity: 1.0,
  }).addTo(map);
}

async function centerToRegion(map, region) {
  const info = await fetchJSON(`/api/region_info?region=${encodeURIComponent(region)}`);
  if (info.center) {
    map.setView([info.center[0], info.center[1]], 9);
  }
}

async function main() {
  const regionSel = document.getElementById("region");
  const timeIdxEl = document.getElementById("time_idx");
  const timeLabelEl = document.getElementById("time_label");
  const cloudEl = document.getElementById("cloud");
  const filenameEl = document.getElementById("filename");
  const clearBtn = document.getElementById("clear_poly");
  const downloadBtn = document.getElementById("download_poly");

  const TIME_POINTS = [];
  for (let y = 2020; y <= 2025; y += 1) {
    TIME_POINTS.push({ year: y, quarter: "Jan–Mar", label: `${y} Q1 (Jan–Mar)` });
    TIME_POINTS.push({ year: y, quarter: "Apr–Jun", label: `${y} Q2 (Apr–Jun)` });
    TIME_POINTS.push({ year: y, quarter: "Jul–Sep", label: `${y} Q3 (Jul–Sep)` });
    TIME_POINTS.push({ year: y, quarter: "Oct–Dec", label: `${y} Q4 (Oct–Dec)` });
  }

  const updateTimeLabel = () => {
    const idx = Math.max(0, Math.min(TIME_POINTS.length - 1, Number(timeIdxEl.value)));
    timeLabelEl.textContent = TIME_POINTS[idx].label;
  };

  const regions = await fetchJSON("/api/regions");
  regions.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    regionSel.appendChild(opt);
  });

  const map = initMap("main_map", [7.95, -1.0], 7, { doubleClickZoom: false });
  const draw = createPolygonDrawController(map);
  const classLayers = createClassLayerManager(map);

  updateTimeLabel();
  timeIdxEl.addEventListener("input", updateTimeLabel);

  await classLayers.loadForRegion(regionSel.value);
  await addBoundary(map, regionSel.value);
  await centerToRegion(map, regionSel.value);

  regionSel.addEventListener("change", async () => {
    draw.clear();
    await classLayers.loadForRegion(regionSel.value);
    await addBoundary(map, regionSel.value);
    await centerToRegion(map, regionSel.value);

    setResults({
      status: "region_changed",
      note: "Region updated. Class layer toggles preserved. Polygon cleared.",
    });
  });

  clearBtn.addEventListener("click", () => {
    draw.clear();
    setResults({ status: "polygon_cleared" });
  });

  downloadBtn.addEventListener("click", async () => {
    if (!draw.isClosed()) {
      setResults({ error: "Polygon is not closed. Double-click map or click first point to close." });
      return;
    }

    const filename = (filenameEl.value || "").trim();
    if (!filename) {
      setResults({ error: "Filename is required." });
      return;
    }

    const payload = {
      polygon: draw.getLngLatPolygon(),
      filename,
      year: TIME_POINTS[Number(timeIdxEl.value)].year,
      quarter: TIME_POINTS[Number(timeIdxEl.value)].quarter,
      cloud: Number(cloudEl.value),
      scale: 20,
      buffer: 12,
      region: regionSel.value,
    };

    setResults({ status: "processing", note: "Extracting full drivable network + Sentinel-2 stats..." });

    try {
      const res = await fetchJSON("/api/export_polygon_network_s2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setResults(res);
    } catch (err) {
      setResults({ status: "error", error: err.message });
    }
  });

  renderMetrics();
  setResults({ status: "ready", note: "Draw polygon and click download to extract network + Sentinel-2." });
}

main();
