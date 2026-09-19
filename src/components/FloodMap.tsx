import { useMemo } from "react";
import type {
  BoundaryOutlet,
  Region,
  RegionFrame,
  RiskThresholds,
  SimulationFrame,
} from "../shared/simulation";
import { formatDepth } from "../app/format";
import { depthColor, terrainColor } from "./colors";

export type MapMode = "depth" | "risk" | "terrain";

interface Props {
  readonly title: string;
  readonly subtitle?: string;
  readonly regions: readonly Region[];
  readonly outlets: readonly BoundaryOutlet[];
  readonly frame: SimulationFrame | null;
  readonly thresholds: RiskThresholds;
  readonly mode: MapMode;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly stale?: boolean;
}

interface Layout {
  readonly size: number;
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  readonly zMin: number;
  readonly zMax: number;
}

function layoutFor(regions: readonly Region[]): Layout {
  let size = Infinity;
  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) {
      const a = regions[i]!.center;
      const b = regions[j]!.center;
      const d = Math.max(Math.abs(a.xM - b.xM), Math.abs(a.yM - b.yM));
      if (d > 0 && d < size) size = d;
    }
  }
  if (!Number.isFinite(size)) size = Math.sqrt(regions[0]?.areaM2 ?? 100);
  const xs = regions.map((r) => r.center.xM);
  const ys = regions.map((r) => r.center.yM);
  const zs = regions.map((r) => r.terrainElevationM);
  const minX = Math.min(...xs) - size / 2;
  const minY = Math.min(...ys) - size / 2;
  return {
    size,
    minX: minX - size * 0.35,
    minY,
    width: Math.max(...xs) + size / 2 - minX + size * 0.35,
    height: Math.max(...ys) + size / 2 - minY,
    zMin: Math.min(...zs),
    zMax: Math.max(...zs),
  };
}

export function FloodMap(props: Props) {
  const { regions, outlets, frame, thresholds, mode, selectedId, onSelect } = props;
  const layout = useMemo(() => layoutFor(regions), [regions]);
  const byId = useMemo(() => {
    const map = new Map<string, RegionFrame>();
    for (const r of frame?.regions ?? []) map.set(r.regionId, r);
    return map;
  }, [frame]);
  const outletRegions = useMemo(() => new Set(outlets.map((o) => o.regionId)), [outlets]);
  const s = layout.size;
  const inset = s * 0.03;

  return (
    <figure className={`map-card${props.stale ? " is-stale" : ""}`}>
      <figcaption>
        <span className="map-title">{props.title}</span>
        {props.subtitle ? <span className="map-subtitle">{props.subtitle}</span> : null}
      </figcaption>
      <svg
        viewBox={`${layout.minX} ${layout.minY} ${layout.width} ${layout.height}`}
        className="flood-map"
        role="img"
        aria-label={`${props.title} flood map`}
      >
        {regions.map((region) => {
          const state = byId.get(region.id);
          const x = region.center.xM - s / 2;
          const y = region.center.yM - s / 2;
          const depth = state?.waterDepthM ?? region.initialWaterDepthM;
          const risk = state?.risk;
          const base = terrainColor(region.terrainElevationM, layout.zMin, layout.zMax);
          let fill: string;
          if (mode === "terrain" || !state) fill = base;
          else if (mode === "risk") fill = `var(--risk-${risk}-fill)`;
          else fill = depthColor(depth, thresholds, base);
          const riskStroke =
            mode === "depth" && risk && risk !== "safe" ? `var(--risk-${risk})` : "none";
          const selected = region.id === selectedId;
          return (
            <g key={region.id} className="cell" onClick={() => onSelect(region.id)}>
              <rect
                x={x + inset}
                y={y + inset}
                width={s - inset * 2}
                height={s - inset * 2}
                rx={s * 0.06}
                fill={fill}
                stroke={riskStroke}
                strokeWidth={s * 0.06}
              />
              {outletRegions.has(region.id) ? (
                <rect x={x - s * 0.3} y={y} width={s * 0.22} height={s} className="river" />
              ) : null}
              {state && state.pumpCapacityM3PerS > 0 ? (
                <g className="marker pump" transform={`translate(${x + s * 0.72} ${y + s * 0.28})`}>
                  <circle r={s * 0.17} />
                  <text dy={s * 0.07} fontSize={s * 0.2}>P</text>
                </g>
              ) : null}
              {state && state.drainOpenFraction < 1 ? (
                <g className="marker drain" transform={`translate(${x + s * 0.28} ${y + s * 0.72})`}>
                  <rect x={-s * 0.14} y={-s * 0.14} width={s * 0.28} height={s * 0.28} rx={s * 0.04} />
                  <text dy={s * 0.07} fontSize={s * 0.2}>{state.drainOpenFraction === 0 ? "×" : "½"}</text>
                </g>
              ) : null}
              {selected ? (
                <rect
                  x={x + inset}
                  y={y + inset}
                  width={s - inset * 2}
                  height={s - inset * 2}
                  rx={s * 0.06}
                  className="selected-outline"
                  strokeWidth={s * 0.07}
                />
              ) : null}
              <title>
                {`${region.label} · terrain ${region.terrainElevationM.toFixed(2)} m`}
                {state ? ` · depth ${formatDepth(state.waterDepthM)} · ${state.risk}` : ""}
              </title>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
