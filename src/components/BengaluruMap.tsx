import { useEffect, useMemo, useRef, useState } from "react";
import type { SimulationConfig, SimulationFrame } from "../shared/simulation";
import { BENGALURU_GRID, loadBengaluruLayers, localToLngLat, project, type BengaluruLayers, type DrainCategory } from "../app/bengaluru";

const WIDTH = 1000;
const HEIGHT = 490;
const COLORS: Record<DrainCategory, string> = { primary: "#09a7b9", secondary: "#2679e2", tertiary: "#9965d8", unclassified: "#8d99a7" };
const CATEGORIES: readonly DrainCategory[] = ["primary", "secondary", "tertiary", "unclassified"];
const CITY = project(77.60, 12.99);
const DEMO = project(...localToLngLat(BENGALURU_GRID.cols * BENGALURU_GRID.cellM / 2, BENGALURU_GRID.rows * BENGALURU_GRID.cellM / 2));

function linePath(line: readonly (readonly number[])[], close = false): string {
  return line.map((p, i) => {
    const [x, y] = project(p[0]!, p[1]!);
    return `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join("") + (close ? "Z" : "");
}

export function BengaluruMap({ config, frame, selectedId, onSelect }: {
  readonly config: SimulationConfig;
  readonly frame: SimulationFrame | null;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}) {
  const [layers, setLayers] = useState<BengaluruLayers | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState({ center: CITY, zoom: 11 });
  const [streets, setStreets] = useState(false);
  const [tileFailed, setTileFailed] = useState(false);
  const [showLakes, setShowLakes] = useState(true);
  const [showCells, setShowCells] = useState(false);
  const [visible, setVisible] = useState<Record<DrainCategory, boolean>>({ primary: true, secondary: true, tertiary: true, unclassified: true });
  const drag = useRef<{ x: number; y: number; center: [number, number]; moved: boolean; regionId: string | null } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let active = true;
    loadBengaluruLayers().then((value) => { if (active) setLayers(value); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Map data could not be loaded."); });
    return () => { active = false; };
  }, []);
  const paths = useMemo(() => {
    const drains = { primary: "", secondary: "", tertiary: "", unclassified: "" };
    for (const feature of layers?.drains.features ?? []) {
      drains[feature.properties.category] += feature.geometry.coordinates.map((line) => linePath(line)).join("");
    }
    const lakes = (layers?.lakes.features ?? []).map((f) => f.geometry.coordinates
      .map((polygon) => polygon.map((ring) => linePath(ring, true)).join("")).join("")).join("");
    return { drains, lakes };
  }, [layers]);
  const states = useMemo(() => new Map(frame?.regions.map((r) => [r.regionId, r]) ?? []), [frame]);
  const scale = 2 ** (12 - view.zoom);
  const left = view.center[0] - WIDTH * scale / 2;
  const top = view.center[1] - HEIGHT * scale / 2;
  const tileSize = 256 * scale;
  const tiles: { x: number; y: number }[] = [];
  if (streets) {
    for (let y = Math.floor(top / tileSize); y <= Math.floor((top + HEIGHT * scale) / tileSize); y += 1) {
      for (let x = Math.floor(left / tileSize); x <= Math.floor((left + WIDTH * scale) / tileSize); x += 1) tiles.push({ x, y });
    }
  }
  const total = Object.values(layers?.manifest.drainCounts ?? {}).reduce((a, b) => a + b, 0);
  const outline = [localToLngLat(0, 0), localToLngLat(BENGALURU_GRID.cols * BENGALURU_GRID.cellM, 0),
    localToLngLat(BENGALURU_GRID.cols * BENGALURU_GRID.cellM, BENGALURU_GRID.rows * BENGALURU_GRID.cellM),
    localToLngLat(0, BENGALURU_GRID.rows * BENGALURU_GRID.cellM)];
  const zoom = (delta: number) => setView((v) => ({ ...v, zoom: Math.max(10, Math.min(16, v.zoom + delta)) }));

  return <section className="bengaluru-atlas" aria-labelledby="bengaluru-map-heading">
    <div className="atlas-heading">
      <div><p className="atlas-kicker">BENGALURU · PUBLIC WATER INFRASTRUCTURE</p>
        <h2 id="bengaluru-map-heading">The city beneath the rain</h2>
        <p>{layers ? `${total.toLocaleString()} mapped drain features · ${layers.manifest.lakeCount.toLocaleString()} lakes / tanks` : "Loading the published drainage network…"}</p></div>
      <div className="atlas-presets">
        <button type="button" className="btn btn-quiet" onClick={() => setView({ center: CITY, zoom: 11 })}>Whole city</button>
        <button type="button" className="btn btn-quiet" onClick={() => { setView({ center: DEMO, zoom: 13 }); setShowCells(true); }}>Bellandur model area</button>
      </div>
    </div>
    {error ? <p role="alert" className="notice notice-error">{error}</p> : null}
    <div className="atlas-layers" aria-label="Map layers">
      {CATEGORIES.filter((c) => c !== "unclassified" || (layers?.manifest.drainCounts[c] ?? 0) > 0).map((category) =>
        <label key={category}><input type="checkbox" checked={visible[category]} onChange={(e) => setVisible((v) => ({ ...v, [category]: e.target.checked }))} />
          <span className="atlas-line-key" style={{ background: COLORS[category] }} />{category} <small>{layers?.manifest.drainCounts[category]?.toLocaleString() ?? "…"}</small></label>)}
      <label><input type="checkbox" checked={showLakes} onChange={(e) => setShowLakes(e.target.checked)} />Lakes</label>
      <label><input type="checkbox" checked={showCells} onChange={(e) => setShowCells(e.target.checked)} />{frame ? "Simulated risk" : "Model cells"}</label>
      <label><input type="checkbox" checked={streets} onChange={(e) => { setStreets(e.target.checked); setTileFailed(false); }} />Street basemap (online)</label>
    </div>
    <div className="atlas-canvas">
      <svg ref={svgRef} viewBox={`${left} ${top} ${WIDTH * scale} ${HEIGHT * scale}`} role="img"
        aria-label="Bengaluru drainage map: drag to pan; use zoom buttons or arrow keys"
        tabIndex={0} onKeyDown={(e) => {
          if (e.key === "+" || e.key === "=") zoom(1);
          else if (e.key === "-") zoom(-1);
          else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault(); setView((v) => ({ ...v, center: [v.center[0] + (e.key === "ArrowRight" ? 100 : e.key === "ArrowLeft" ? -100 : 0) * scale,
              v.center[1] + (e.key === "ArrowDown" ? 100 : e.key === "ArrowUp" ? -100 : 0) * scale] }));
          }
        }}
        onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = {
          x: e.clientX, y: e.clientY, center: view.center, moved: false,
          regionId: e.target instanceof Element ? e.target.getAttribute("data-region") : null,
        }; }}
        onPointerMove={(e) => {
          if (!drag.current || !svgRef.current) return;
          const ratio = WIDTH * scale / svgRef.current.getBoundingClientRect().width;
          const dx = (e.clientX - drag.current.x) * ratio; const dy = (e.clientY - drag.current.y) * ratio;
          if (Math.abs(dx) + Math.abs(dy) > 4 * ratio) drag.current.moved = true;
          if (drag.current.moved) setView((v) => ({ ...v, center: [drag.current!.center[0] - dx, drag.current!.center[1] - dy] }));
        }}
        onPointerUp={() => { if (drag.current && !drag.current.moved && drag.current.regionId) onSelect(drag.current.regionId); drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}>
        <rect x={left} y={top} width={WIDTH * scale} height={HEIGHT * scale} fill="#101d2a" />
        {tiles.map(({ x, y }) => <image key={`${view.zoom}/${x}/${y}`} x={x * tileSize} y={y * tileSize} width={tileSize} height={tileSize}
          href={`https://tile.openstreetmap.org/${view.zoom}/${x}/${y}.png`} opacity={0.72} onError={() => setTileFailed(true)} />)}
        {showLakes ? <path d={paths.lakes} fill="#239bb04d" stroke="#54bad1" strokeWidth={0.65} vectorEffect="non-scaling-stroke" fillRule="evenodd" /> : null}
        {showCells ? config.regions.map((r) => {
          const size = Math.sqrt(r.areaM2);
          const a = project(...localToLngLat(r.center.xM - size / 2, r.center.yM - size / 2));
          const b = project(...localToLngLat(r.center.xM + size / 2, r.center.yM + size / 2));
          const state = states.get(r.id);
          const color = !state ? "#f5c46b" : state.risk === "critical" ? "#ef6262" : state.risk === "warning" ? "#f7b64e" : "#63c9b1";
          return <rect key={r.id} data-region={r.id} x={a[0]} y={a[1]} width={b[0] - a[0]} height={b[1] - a[1]}
            fill={color} fillOpacity={state ? 0.3 : 0.025} stroke={selectedId === r.id ? "#fff" : "#e9c988"}
            strokeWidth={selectedId === r.id ? 2 : 0.5} vectorEffect="non-scaling-stroke"
            tabIndex={0} role="button" aria-label={`Select ${r.label}`}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(r.id); } }}
          ><title>{`${r.label} · ${state ? `${(state.waterDepthM * 100).toFixed(1)} cm simulated depth` : `${r.terrainElevationM} m DEM elevation`}`}</title></rect>;
        }) : null}
        {CATEGORIES.map((category) => visible[category] ? <path key={category} d={paths.drains[category]} fill="none"
          stroke={COLORS[category]} strokeWidth={category === "primary" ? 2 : category === "secondary" ? 1.2 : 0.65}
          strokeOpacity={category === "tertiary" ? 0.72 : 1} vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null)}
        <path d={linePath(outline, true)} fill="none" stroke="#ffd488" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <text x={project(...outline[0]!)[0]} y={project(...outline[0]!)[1] - 7 * scale} fill="#ffd488" fontSize={11 * scale}>BELLANDUR–MARATHAHALLI · MODEL EXTENT</text>
      </svg>
      <div className="atlas-zoom"><button type="button" onClick={() => zoom(1)} aria-label="Zoom in">+</button><button type="button" onClick={() => zoom(-1)} aria-label="Zoom out">−</button></div>
      <span className="atlas-north" aria-hidden="true">↑ N</span>
      <div className="atlas-attribution">Geometry: <a href="https://data.opencity.in/dataset/bengaluru-stormwater-drains-maps" target="_blank" rel="noreferrer">KSRSAC / OpenCity</a>
        {streets ? <> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></> : null}</div>
    </div>
    {tileFailed && streets ? <p className="muted">Street tiles could not load. The local drainage, lake, and model layers remain available.</p> : null}
    <div className="atlas-footnote">
      <p><strong>Published geometry, not live drain conditions.</strong> Drain layer labelled 2022; portal files updated November 2025.
        All features are retained; lines are simplified by 3 m for display. Downloads preserve source coordinates.
        Coverage is not a verified inventory of every drain.
        {frame ? ` Model overlay: ${config.label}, T+${Math.round(frame.timeS / 60)} min.` : " Dashed area: the coarse simulation domain."}</p>
      <div><a href={`${import.meta.env.BASE_URL}data/bengaluru/stormwater-drains.geojson`} download>Download drains</a>
        <a href={`${import.meta.env.BASE_URL}data/bengaluru/lakes.geojson`} download>Download lakes</a>
        <a href={`${import.meta.env.BASE_URL}data/bengaluru/manifest.json`} target="_blank" rel="noreferrer">Sources &amp; provenance</a></div>
    </div>
  </section>;
}
