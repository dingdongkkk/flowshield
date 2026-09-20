import { useEffect, useMemo, useRef, useState } from "react";
import {
  FullscreenControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type {
  RegionFrame,
  RiskThresholds,
  SimulationConfig,
  SimulationFrame,
  SimulationResult,
} from "../shared/simulation";
import { BENGALURU_CELLS, localToLngLat } from "../app/bengaluru";
import { formatDepth, formatModelTime, formatSigned } from "../app/format";
import { crossingText } from "./WarningTable";
import { EVENT_2022 } from "../data/event-2022";
import { buildingsCriticalNow, buildingsIn } from "../app/insights";

/**
 * Interactive flood atlas. Key-free sources only: OpenFreeMap / CARTO vector
 * basemaps, Esri imagery, and AWS Terrain Tiles (Terrarium) for relief.
 */

type Basemap = "dark" | "light" | "streets" | "satellite";
type Overlay = "baseline" | "response" | "difference";
type Colouring = "depth" | "risk";

interface Side {
  readonly result: SimulationResult;
  readonly frame: SimulationFrame;
}

export interface AtlasCamera {
  readonly center: [number, number];
  readonly zoom: number;
  readonly pitch: number;
  readonly bearing: number;
}

interface Props {
  readonly config: SimulationConfig;
  readonly baseline: Side | null;
  readonly response: Side | null;
  readonly thresholds: RiskThresholds;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly cursorTimeS: number;
  readonly rainNow: number | null;
  readonly running: boolean;
  /** Show places reported flooded on 4-5 Sep 2022. */
  readonly showReports: boolean;
  readonly presentation?: {
    readonly overlay: "baseline" | "response";
    readonly camera: AtlasCamera | null;
    readonly onCameraChange: (camera: AtlasCamera) => void;
    readonly threeD: boolean;
    readonly colouring: Colouring;
  };
}

// Vite pre-bundles maplibre-gl, which breaks its relative worker lookup;
// ?worker&url bundles the worker together with its shared chunk.
setWorkerUrl(maplibreWorkerUrl);

const DATA = `${import.meta.env.BASE_URL}data/bengaluru/`;
const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const CITY_VIEW = { center: [77.62, 12.97] as [number, number], zoom: 10.6, pitch: 0, bearing: 0 };
const ATTR_TERRAIN = 'Relief: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">AWS Terrain Tiles</a>';
const ATTR_DRAINS = 'Drains &amp; lakes: <a href="https://data.opencity.in/dataset/bengaluru-stormwater-drains-maps" target="_blank" rel="noreferrer">KSRSAC / OpenCity</a>';

const BASEMAPS: Record<Basemap, { label: string; style: string | StyleSpecification; dark: boolean }> = {
  dark: { label: "Dark", style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json", dark: true },
  light: { label: "Light", style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json", dark: false },
  streets: { label: "Streets", style: "https://tiles.openfreemap.org/styles/liberty", dark: false },
  satellite: {
    label: "Satellite",
    dark: true,
    style: {
      version: 8,
      sources: {
        imagery: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 19,
          attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
        },
      },
      layers: [{ id: "imagery", type: "raster", source: "imagery" }],
    },
  },
};

const DRAIN_COLORS = { primary: "#19c3d6", secondary: "#3d8bff", tertiary: "#a879ff", unclassified: "#94a3b8" } as const;

// ---- colour ramps (hex strings, safe for MapLibre's parser) ----
type Rgb = readonly [number, number, number];
const WATER: readonly Rgb[] = [[164, 219, 255], [72, 170, 240], [30, 110, 214], [22, 64, 170], [42, 22, 120]];
const RISK: Record<RegionFrame["risk"], string> = { safe: "#34d399", warning: "#fbbf24", critical: "#f43f5e" };
const hex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
function ramp(stops: readonly Rgb[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = stops[i]!;
  const b = stops[i + 1]!;
  const f = x - i;
  return hex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}
function diffColor(delta: number, scale: number): string {
  const t = Math.min(1, Math.abs(delta) / scale);
  return delta < 0 ? ramp([[226, 232, 240], [45, 212, 191], [13, 148, 136]], t) : ramp([[226, 232, 240], [251, 146, 60], [220, 38, 38]], t);
}

type LngLat = [number, number];
interface PolygonFeature { type: "Feature"; properties: Record<string, unknown>; geometry: { type: "Polygon"; coordinates: LngLat[][] } }
interface PointFeature { type: "Feature"; properties: Record<string, unknown>; geometry: { type: "Point"; coordinates: LngLat } }

interface CellState {
  readonly h: number;
  readonly color: string;
  readonly opacity: number;
  /** Draw as a 3D column (otherwise draped flat). */
  readonly column: boolean;
}

function cellGeoJson(config: SimulationConfig): { type: "FeatureCollection"; features: PolygonFeature[] } {
  return {
    type: "FeatureCollection",
    features: config.regions.map((r) => {
      const half = Math.sqrt(r.areaM2) / 2;
      const corner = (dx: number, dy: number) => localToLngLat(r.center.xM + dx, r.center.yM + dy);
      return {
        type: "Feature",
        properties: { id: r.id, label: r.label, elevation: r.terrainElevationM },
        geometry: {
          type: "Polygon",
          coordinates: [[corner(-half, -half), corner(half, -half), corner(half, half), corner(-half, half), corner(-half, -half)]],
        },
      };
    }),
  };
}

function extentOf(config: SimulationConfig): [[number, number], [number, number]] {
  const pts = config.regions.flatMap((r) => {
    const half = Math.sqrt(r.areaM2) / 2;
    return [localToLngLat(r.center.xM - half, r.center.yM - half), localToLngLat(r.center.xM + half, r.center.yM + half)];
  });
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

function pumpPoints(config: SimulationConfig, frame: SimulationFrame | null) {
  const byId = new Map(config.regions.map((r) => [r.id, r]));
  const features: PointFeature[] = [];
  for (const s of frame?.regions ?? []) {
    const r = byId.get(s.regionId);
    if (!r) continue;
    if (s.pumpCapacityM3PerS > 0) {
      features.push({ type: "Feature", properties: { kind: "pump" }, geometry: { type: "Point", coordinates: localToLngLat(r.center.xM + Math.sqrt(r.areaM2) * 0.2, r.center.yM - Math.sqrt(r.areaM2) * 0.2) } });
    }
    if (s.drainageCapacityM3PerS > r.drainageCapacityM3PerS) {
      features.push({ type: "Feature", properties: { kind: "upgrade" }, geometry: { type: "Point", coordinates: localToLngLat(r.center.xM + Math.sqrt(r.areaM2) * 0.2, r.center.yM + Math.sqrt(r.areaM2) * 0.2) } });
    }
    if (s.drainOpenFraction < 1) {
      features.push({ type: "Feature", properties: { kind: s.drainOpenFraction === 0 ? "blocked" : "partial" }, geometry: { type: "Point", coordinates: localToLngLat(r.center.xM - Math.sqrt(r.areaM2) * 0.2, r.center.yM + Math.sqrt(r.areaM2) * 0.2) } });
    }
  }
  return { type: "FeatureCollection" as const, features };
}

/** Adds every custom source and layer; re-run after each basemap style load. */
function addOverlays(map: MapLibreMap, config: SimulationConfig) {
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  // Separate DEM sources for 3D terrain and hillshade, as MapLibre recommends.
  // Coarser mesh for 3D terrain: fewer tile seams, and ample for a 10 km model area.
  map.addSource("dem", { type: "raster-dem", tiles: [TERRAIN_TILES], encoding: "terrarium", tileSize: 256, maxzoom: 12, attribution: ATTR_TERRAIN });
  map.addSource("dem-shade", { type: "raster-dem", tiles: [TERRAIN_TILES], encoding: "terrarium", tileSize: 256, maxzoom: 14 });
  map.addLayer({
    id: "hillshade", type: "hillshade", source: "dem-shade",
    paint: { "hillshade-exaggeration": 0.45, "hillshade-shadow-color": "#0b1220", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#1e293b" },
  }, firstSymbol);

  map.addSource("lakes", { type: "geojson", data: `${DATA}lakes.display.geojson`, attribution: ATTR_DRAINS });
  map.addLayer({ id: "lakes-fill", type: "fill", source: "lakes", paint: { "fill-color": "#22d3ee", "fill-opacity": 0.28 } }, firstSymbol);
  map.addLayer({ id: "lakes-line", type: "line", source: "lakes", paint: { "line-color": "#67e8f9", "line-width": 0.8, "line-opacity": 0.8 } }, firstSymbol);

  map.addSource("drains", { type: "geojson", data: `${DATA}stormwater-drains.display.geojson` });
  map.addLayer({
    id: "drains", type: "line", source: "drains",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["match", ["get", "category"], "primary", DRAIN_COLORS.primary, "secondary", DRAIN_COLORS.secondary, "tertiary", DRAIN_COLORS.tertiary, DRAIN_COLORS.unclassified] as ExpressionSpecification,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "category"], "primary", 1.6, "secondary", 0.9, 0.45], 15, ["match", ["get", "category"], "primary", 5, "secondary", 3, 1.6]] as ExpressionSpecification,
      "line-opacity": 0.85,
    },
  }, firstSymbol);

  map.addSource("cells", { type: "geojson", data: cellGeoJson(config), promoteId: "id" });
  // 3D columns only for cells with visible water, so dry cells never z-fight the terrain.
  map.addSource("columns", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "cells-extrusion", type: "fill-extrusion", source: "columns",
    paint: {
      "fill-extrusion-color": ["get", "color"] as ExpressionSpecification,
      "fill-extrusion-height": ["get", "h"] as ExpressionSpecification,
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.88,
      "fill-extrusion-vertical-gradient": true,
    },
  });
  map.addLayer({
    id: "cells-fill", type: "fill", source: "cells",
    paint: { "fill-color": ["coalesce", ["feature-state", "color"], "#fcd34d"] as ExpressionSpecification, "fill-opacity": ["coalesce", ["feature-state", "opacity"], 0.04] as ExpressionSpecification },
  });
  map.addLayer({
    id: "cells-grid", type: "line", source: "cells",
    paint: { "line-color": "#fde68a", "line-width": 0.6, "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.35] as ExpressionSpecification },
  });
  map.addLayer({
    id: "cells-detention", type: "line", source: "cells",
    paint: {
      "line-color": "#4ade80", "line-width": 1.2, "line-dasharray": [2, 1.5],
      "line-opacity": ["case", ["boolean", ["feature-state", "detained"], false], 0.55, 0] as ExpressionSpecification,
    },
  });
  map.addLayer({ id: "cells-selected", type: "line", source: "cells", filter: ["==", ["get", "id"], ""], paint: { "line-color": "#ffffff", "line-width": 3 } });

  const [[w, s], [e, n]] = extentOf(config);
  map.addSource("extent", {
    type: "geojson",
    data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[w, n], [e, n], [e, s], [w, s], [w, n]] } },
  });
  map.addLayer({ id: "extent", type: "line", source: "extent", paint: { "line-color": "#fbbf24", "line-width": 1.6, "line-dasharray": [3, 2] } });

  map.addSource("reports", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: EVENT_2022.reportedFloodedPlaces.map((p) => ({
        type: "Feature" as const, properties: { name: p.name }, geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      })),
    },
  });
  map.addLayer({
    id: "reports", type: "circle", source: "reports", layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 15, 12] as ExpressionSpecification,
      "circle-color": "#fde047", "circle-opacity": 0.9,
      "circle-stroke-color": "#111827", "circle-stroke-width": 2.5,
    },
  });

  map.addSource("markers", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "markers", type: "circle", source: "markers",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "kind"], "upgrade", 2, 3.5], 15, ["match", ["get", "kind"], "upgrade", 6, 10]] as ExpressionSpecification,
      "circle-color": ["match", ["get", "kind"], "pump", "#8b5cf6", "upgrade", "#06b6d4", "blocked", "#111827", "#6b7280"] as ExpressionSpecification,
      "circle-stroke-color": ["match", ["get", "kind"], "pump", "#ede9fe", "upgrade", "#ecfeff", "#f43f5e"] as ExpressionSpecification,
      "circle-stroke-width": ["match", ["get", "kind"], "upgrade", 1, 2] as ExpressionSpecification,
    },
  });
}

export function FloodAtlas(props: Props) {
  const { config, baseline, response, thresholds, selectedId, onSelect } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(0); // bumps after every style (re)load
  const [basemap, setBasemap] = useState<Basemap>("dark");
  const [localThreeD, setThreeD] = useState(true);
  const [overlay, setOverlay] = useState<Overlay>("baseline");
  const [localColouring, setColouring] = useState<Colouring>("depth");
  const threeD = props.presentation?.threeD ?? localThreeD;
  const colouring = props.presentation?.colouring ?? localColouring;
  const [layers, setLayers] = useState({ drains: true, lakes: true, relief: true });
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [mapError, setMapError] = useState("");
  const configRef = useRef(config);
  configRef.current = config;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const presentationRef = useRef(props.presentation);
  presentationRef.current = props.presentation;
  const syncingCamera = useRef(false);

  const effectiveOverlay: Overlay = props.presentation?.overlay ?? (response ? overlay : "baseline");
  const hasResults = baseline !== null;
  const shown = effectiveOverlay === "response" ? response : baseline;

  // ---- create the map once ----
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAPS.dark.style,
      ...CITY_VIEW,
      maxPitch: 75,
      attributionControl: { compact: true, customAttribution: ATTR_DRAINS },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");
    if (!presentationRef.current) map.addControl(new FullscreenControl(), "top-right");
    let introduced = false;
    map.on("style.load", () => {
      addOverlays(map, configRef.current);
      setReady((n) => n + 1);
      if (!introduced) {
        introduced = true;
        const presentation = presentationRef.current;
        if (presentation?.camera) map.jumpTo(presentation.camera);
        else map.fitBounds(extentOf(configRef.current), {
          padding: presentation ? 36 : 70, pitch: presentation ? 0 : 55,
          bearing: presentation ? 0 : -20, duration: presentation ? 0 : 2600,
        });
      }
    });
    map.on("error", (e) => {
      const message = e.error?.message ?? "";
      if (import.meta.env.DEV) console.error("[atlas]", message);
      if (/style/i.test(message)) setMapError("The basemap could not load. Check the network or switch basemap.");
    });
    let hovered: string | null = null;
    map.on("mousemove", "cells-fill", (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      const id = typeof f?.properties.id === "string" ? f.properties.id : null;
      if (hovered && hovered !== id) map.setFeatureState({ source: "cells", id: hovered }, { hover: false });
      hovered = id;
      if (id) {
        map.setFeatureState({ source: "cells", id }, { hover: true });
        setHover({ id, x: e.point.x, y: e.point.y });
        map.getCanvas().style.cursor = "pointer";
      }
    });
    map.on("mouseleave", "cells-fill", () => {
      if (hovered) map.setFeatureState({ source: "cells", id: hovered }, { hover: false });
      hovered = null;
      setHover(null);
      map.getCanvas().style.cursor = "";
    });
    map.on("click", "cells-fill", (e) => {
      const id = e.features?.[0]?.properties.id;
      if (typeof id === "string") onSelectRef.current(id);
    });
    map.on("move", (event) => {
      if (!introduced || syncingCamera.current || !presentationRef.current ||
          (event as typeof event & { presentationSync?: boolean }).presentationSync) return;
      // Only the user's map drives the shared camera. Resize/style events on
      // the follower must not feed an old camera back into an active gesture.
      if (!event.originalEvent && presentationRef.current.camera) return;
      const center = map.getCenter();
      presentationRef.current.onCameraChange({ center: [center.lng, center.lat],
        zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() });
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(containerRef.current);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const camera = props.presentation?.camera;
    if (!map || !camera || !ready) return;
    const center = map.getCenter();
    if (Math.abs(center.lng - camera.center[0]) < 1e-8 && Math.abs(center.lat - camera.center[1]) < 1e-8 &&
        Math.abs(map.getZoom() - camera.zoom) < 1e-8 && Math.abs(map.getPitch() - camera.pitch) < 1e-8 &&
        Math.abs(map.getBearing() - camera.bearing) < 1e-8) return;
    syncingCamera.current = true;
    map.jumpTo(camera, { presentationSync: true });
    syncingCamera.current = false;
  }, [props.presentation?.camera, ready]);

  // ---- basemap switch ----
  const firstBasemap = useRef(true);
  useEffect(() => {
    if (firstBasemap.current) {
      firstBasemap.current = false;
      return;
    }
    setMapError("");
    mapRef.current?.setStyle(BASEMAPS[basemap].style);
  }, [basemap]);

  // ---- config geometry (fixture vs Bengaluru) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("cells") as GeoJSONSource | undefined)?.setData(cellGeoJson(config));
  }, [config, ready]);

  // ---- terrain / 3D ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setTerrain(threeD ? { source: "dem", exaggeration: 1.6 } : null);
  }, [threeD, ready]);

  const previousThreeD = useRef(threeD);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || previousThreeD.current === threeD) return;
    previousThreeD.current = threeD;
    if (presentationRef.current) return; // Shared camera controls both views.
    map.easeTo({ pitch: threeD ? 55 : 0, bearing: threeD ? map.getBearing() : 0, duration: presentationRef.current ? 0 : 900 });
  }, [threeD]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty("cells-extrusion", "visibility", threeD && hasResults ? "visible" : "none");
  }, [threeD, hasResults, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty("reports", "visibility", props.showReports ? "visible" : "none");
  }, [props.showReports, ready]);

  // ---- layer toggles ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    map.setLayoutProperty("drains", "visibility", vis(layers.drains));
    map.setLayoutProperty("lakes-fill", "visibility", vis(layers.lakes));
    map.setLayoutProperty("lakes-line", "visibility", vis(layers.lakes));
    map.setLayoutProperty("hillshade", "visibility", vis(layers.relief));
  }, [layers, ready]);

  // ---- per-frame cell state ----
  const scaleMax = thresholds.criticalDepthM * 2;
  const states = useMemo(() => {
    const out = new Map<string, CellState>();
    const bById = new Map(baseline?.frame.regions.map((r) => [r.regionId, r]) ?? []);
    const rById = new Map(response?.frame.regions.map((r) => [r.regionId, r]) ?? []);
    const heightPerM = threeD ? 260 : 0;
    for (const region of config.regions) {
      if (effectiveOverlay === "difference") {
        const b = bById.get(region.id);
        const r = rById.get(region.id);
        if (!b || !r) continue;
        const delta = r.waterDepthM - b.waterDepthM;
        const visible = Math.abs(delta) > 0.002;
        out.set(region.id, { h: Math.abs(delta) * heightPerM * 4, color: diffColor(delta, 0.15), opacity: visible ? 0.7 : 0.05, column: visible });
        continue;
      }
      const s = (effectiveOverlay === "response" ? rById : bById).get(region.id);
      if (!s) continue;
      const wet = s.waterDepthM > 0.005;
      out.set(region.id, {
        h: s.waterDepthM * heightPerM,
        color: colouring === "risk" ? RISK[s.risk] : ramp(WATER, s.waterDepthM / scaleMax),
        opacity: colouring === "risk" ? (s.risk === "safe" ? 0.28 : 0.55) : wet ? Math.min(0.75, 0.25 + s.waterDepthM / scaleMax) : 0.05,
        column: wet && (colouring === "depth" || s.risk !== "safe"),
      });
    }
    return out;
  }, [config, baseline, response, effectiveOverlay, colouring, threeD, scaleMax]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource("cells")) return;
    const controlFrame = effectiveOverlay === "baseline" ? baseline?.frame ?? null : response?.frame ?? null;
    const columns = cellGeoJson(config);
    columns.features = columns.features.filter((f) => {
      const s = states.get(String(f.properties.id));
      const detained = (controlFrame?.regions.find((r) => r.regionId === f.properties.id)?.surfaceOutflowFactor ?? 1) < 1;
      map.setFeatureState({ source: "cells", id: String(f.properties.id) }, s ? { color: s.color, opacity: s.column && threeD ? 0.12 : s.opacity, detained } : { color: "#fcd34d", opacity: 0.04, detained });
      if (!s?.column) return false;
      f.properties = { ...f.properties, h: s.h, color: s.color };
      return true;
    });
    (map.getSource("columns") as GeoJSONSource | undefined)?.setData(columns);
    (map.getSource("markers") as GeoJSONSource | undefined)?.setData(
      pumpPoints(config, effectiveOverlay === "baseline" ? baseline?.frame ?? null : response?.frame ?? null),
    );
  }, [states, ready, config, baseline, response, effectiveOverlay, threeD]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("cells-selected", ["==", ["get", "id"], selectedId ?? ""]);
  }, [selectedId, ready]);

  const flyToModel = () => mapRef.current?.fitBounds(extentOf(config), { padding: 60, pitch: threeD ? 52 : 0, bearing: threeD ? -18 : 0, duration: 1600 });
  const flyToCity = () => mapRef.current?.flyTo({ ...CITY_VIEW, pitch: threeD ? 40 : 0, duration: 1600 });

  // ---- hover card content ----
  const hoverRegion = hover ? config.regions.find((r) => r.id === hover.id) : undefined;
  const hoverGeo = hover ? BENGALURU_CELLS.get(hover.id) : undefined;
  const bState = hover ? baseline?.frame.regions.find((r) => r.regionId === hover.id) : undefined;
  const rState = hover ? response?.frame.regions.find((r) => r.regionId === hover.id) : undefined;
  const bSummary = hover ? baseline?.result.summary.regions.find((r) => r.regionId === hover.id) : undefined;
  const rSummary = hover ? response?.result.summary.regions.find((r) => r.regionId === hover.id) : undefined;

  const counts = shown?.frame.riskCounts;
  const noVisibleDifference =
    effectiveOverlay === "difference" && [...states.values()].every((st) => !st.column);
  const isDark = BASEMAPS[basemap].dark;

  return (
    <section className={`atlas${isDark ? " atlas-dark" : ""}${props.presentation ? " atlas-present" : ""}`} aria-label={props.presentation ? `${props.presentation.overlay} flood map` : "Flood atlas"}>
      <div ref={containerRef} className="atlas-map" />

      {/* Top-left: title + live readout */}
      <div className="atlas-hud atlas-hud-tl">
        <p className="atlas-kicker">Bellandur – Marathahalli · Bengaluru</p>
        <div className="atlas-readout">
          <div><span>Model time</span><strong>T+{formatModelTime(props.cursorTimeS)}</strong></div>
          <div><span>Rain</span><strong>{props.rainNow === null ? "—" : `${props.rainNow} mm/h`}</strong></div>
          {counts && effectiveOverlay !== "difference" ? (
            <>
              <div className="is-critical"><span>Critical</span><strong>{counts.critical}</strong></div>
              <div className="is-warning"><span>Warning</span><strong>{counts.warning}</strong></div>
              {shown ? <div><span>Buildings in critical cells</span><strong>{buildingsCriticalNow(shown.frame).toLocaleString()}</strong></div> : null}
            </>
          ) : null}
        </div>
        <div className="atlas-controls">
          {response ? (
            <div className="atlas-seg" role="group" aria-label="Scenario shown">
              {(["baseline", "response", "difference"] as const).map((o) => (
                <button key={o} type="button" className={effectiveOverlay === o ? "is-on" : ""} onClick={() => setOverlay(o)}>
                  {o === "baseline" ? "Baseline" : o === "response" ? "Response" : "Difference"}
                </button>
              ))}
            </div>
          ) : null}
          {effectiveOverlay !== "difference" ? (
            <div className="atlas-seg" role="group" aria-label="Cell colouring">
              {(["depth", "risk"] as const).map((c) => (
                <button key={c} type="button" className={colouring === c ? "is-on" : ""} onClick={() => setColouring(c)}>
                  {c === "depth" ? "Depth" : "Risk"}
                </button>
              ))}
            </div>
          ) : null}
          <div className="atlas-seg" role="group" aria-label="Perspective">
            <button type="button" className={threeD ? "is-on" : ""} onClick={() => setThreeD(true)}>3D</button>
            <button type="button" className={!threeD ? "is-on" : ""} onClick={() => setThreeD(false)}>2D</button>
          </div>
        </div>
        {props.running ? <p className="atlas-status"><span className="spinner" /> Simulating…</p> : null}
        {!baseline && !props.running ? <p className="atlas-status">Run a scenario to flood the model cells.</p> : null}
        {noVisibleDifference ? (
          <p className="atlas-status">At this time the response plan changes water depth by less than 2 mm in every cell.</p>
        ) : null}
      </div>

      {/* Right: basemap + layers */}
      <div className="atlas-hud atlas-hud-r">
        <p className="atlas-panel-title">Basemap</p>
        <div className="atlas-basemaps">
          {(Object.keys(BASEMAPS) as Basemap[]).map((b) => (
            <button key={b} type="button" className={`atlas-basemap atlas-basemap-${b}${basemap === b ? " is-on" : ""}`} onClick={() => setBasemap(b)}>
              <span />{BASEMAPS[b].label}
            </button>
          ))}
        </div>
        <p className="atlas-panel-title">Layers</p>
        {([["drains", "Stormwater drains"], ["lakes", "Lakes & tanks"], ["relief", "Terrain relief"]] as const).map(([k, label]) => (
          <label key={k} className="atlas-toggle">
            <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))} />
            <span>{label}</span>
          </label>
        ))}
        <div className="atlas-fly">
          <button type="button" onClick={flyToModel}>Model area</button>
          <button type="button" onClick={flyToCity}>Whole city</button>
        </div>
      </div>

      {/* Bottom-left: legend */}
      <div className="atlas-hud atlas-hud-bl">
        {effectiveOverlay === "difference" ? (
          <>
            <p className="atlas-panel-title">Response − baseline depth</p>
            <div className="atlas-ramp atlas-ramp-diff" />
            <div className="atlas-ramp-labels"><span>less water</span><span>0</span><span>more water</span></div>
          </>
        ) : colouring === "risk" ? (
          <>
            <p className="atlas-panel-title">Risk level</p>
            <div className="atlas-keys">
              <span><i style={{ background: RISK.safe }} />Safe &lt; {Math.round(thresholds.warningDepthM * 100)} cm</span>
              <span><i style={{ background: RISK.warning }} />Warning</span>
              <span><i style={{ background: RISK.critical }} />Critical ≥ {Math.round(thresholds.criticalDepthM * 100)} cm</span>
            </div>
          </>
        ) : (
          <>
            <p className="atlas-panel-title">Water depth{threeD ? " · column height" : ""}</p>
            <div className="atlas-ramp atlas-ramp-water" />
            <div className="atlas-ramp-labels"><span>0</span><span>{Math.round(thresholds.criticalDepthM * 100)} cm</span><span>{Math.round(scaleMax * 100)}+ cm</span></div>
          </>
        )}
        <div className="atlas-keys atlas-keys-small">
          {layers.drains ? (
            <>
              <span><i className="line" style={{ background: DRAIN_COLORS.primary }} />Primary</span>
              <span><i className="line" style={{ background: DRAIN_COLORS.secondary }} />Secondary</span>
              <span><i className="line" style={{ background: DRAIN_COLORS.tertiary }} />Tertiary</span>
            </>
          ) : null}
          {props.showReports ? <span><i className="dot" style={{ background: "#fde047", boxShadow: "0 0 0 2px #111827" }} />Reported flooded, Sep 2022</span> : null}
          <span><i className="dot" style={{ background: "#8b5cf6" }} />Pump</span>
          <span><i className="dot" style={{ background: "#06b6d4" }} />Upgraded drains</span>
          <span><i className="line" style={{ background: "#4ade80" }} />Detention cell</span>
          <span><i className="dot" style={{ background: "#111827", boxShadow: "0 0 0 2px #f43f5e" }} />Blocked drain</span>
        </div>
      </div>

      {mapError ? <div className="atlas-hud atlas-hud-error" role="alert">{mapError}</div> : null}

      {hover && hoverRegion ? (
        <div className="atlas-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hoverRegion.label}</strong>
          <span className="muted">
            Ground {hoverRegion.terrainElevationM.toFixed(0)} m
            {hoverGeo ? ` · ${(hoverGeo.mappedDrainLengthM / 1000).toFixed(1)} km drains mapped` : ""}
            {` · ${buildingsIn(hoverRegion.id).toLocaleString()} buildings`}
          </span>
          {bState ? (
            <div className="atlas-tip-row">
              <span>Baseline</span>
              <b className={`risk-${bState.risk}`}>{formatDepth(bState.waterDepthM)}</b>
              {bSummary ? <em>{crossingText(bSummary.firstCritical, props.cursorTimeS)}</em> : null}
            </div>
          ) : null}
          {rState ? (
            <div className="atlas-tip-row">
              <span>Response</span>
              <b className={`risk-${rState.risk}`}>{formatDepth(rState.waterDepthM)}</b>
              {rSummary ? <em>{crossingText(rSummary.firstCritical, props.cursorTimeS)}</em> : null}
            </div>
          ) : null}
          {bState && rState ? (
            <div className="atlas-tip-row"><span>Change</span><b>{formatSigned((rState.waterDepthM - bState.waterDepthM) * 100, "cm", 1)}</b></div>
          ) : null}
          <span className="atlas-tip-hint">Click to inspect</span>
        </div>
      ) : null}
    </section>
  );
}
