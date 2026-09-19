import type { RiskThresholds } from "../shared/simulation";

type Rgb = readonly [number, number, number];

const WATER_STOPS: readonly Rgb[] = [
  [198, 224, 245],
  [120, 180, 226],
  [52, 128, 196],
  [23, 82, 158],
  [10, 44, 102],
];

const LAND_LOW: Rgb = [214, 205, 176];
const LAND_HIGH: Rgb = [128, 146, 102];

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function css(c: Rgb): string {
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}

function parse(color: string): Rgb {
  const m = /rgb\((\d+) (\d+) (\d+)\)/.exec(color);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : LAND_LOW;
}

export function terrainColor(z: number, zMin: number, zMax: number): string {
  const t = zMax > zMin ? (z - zMin) / (zMax - zMin) : 0.5;
  return css(mix(LAND_LOW, LAND_HIGH, t));
}

/** Shared depth scale: 0 … 2 × critical depth, identical for every map. */
export function depthScaleMax(thresholds: RiskThresholds): number {
  return thresholds.criticalDepthM * 2;
}

export function waterColor(depth: number, thresholds: RiskThresholds): string {
  const t = Math.min(1, Math.max(0, depth / depthScaleMax(thresholds)));
  const scaled = t * (WATER_STOPS.length - 1);
  const i = Math.min(WATER_STOPS.length - 2, Math.floor(scaled));
  return css(mix(WATER_STOPS[i]!, WATER_STOPS[i + 1]!, scaled - i));
}

/** Blend dry terrain into the water ramp over the first few centimetres. */
export function depthColor(depth: number, thresholds: RiskThresholds, terrain: string): string {
  const wet = Math.min(1, depth / Math.max(1e-9, thresholds.warningDepthM * 0.4));
  return css(mix(parse(terrain), parse(waterColor(depth, thresholds)), wet));
}
