import { BENGALURU_TERRAIN } from "../data/bengaluru-terrain";

export const BENGALURU_GRID = BENGALURU_TERRAIN.grid;
export const BENGALURU_CELLS = new Map(BENGALURU_TERRAIN.cells.map((c) => [c.id as string, c]));
export const BENGALURU_EDGE_OUTLETS = BENGALURU_TERRAIN.edgeOutlets;

/** Local model coordinates have x east, y south from the published grid origin. */
export function localToLngLat(xM: number, yM: number): [number, number] {
  return [BENGALURU_GRID.westLng + xM / BENGALURU_GRID.metersPerDegreeLng,
    BENGALURU_GRID.northLat - yM / BENGALURU_GRID.metersPerDegreeLat];
}

/** Web Mercator world pixels at zoom 12, shared by vectors and optional tiles. */
export function project(lng: number, lat: number): [number, number] {
  const size = 256 * 2 ** 12;
  const sin = Math.sin(lat * Math.PI / 180);
  return [(lng + 180) / 360 * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}

export type DrainCategory = "primary" | "secondary" | "tertiary" | "unclassified";
export interface DrainFeature {
  readonly properties: { readonly id: string; readonly category: DrainCategory; readonly sourceObjectId: string };
  readonly geometry: { readonly type: "MultiLineString"; readonly coordinates: readonly (readonly (readonly number[])[])[] };
}
export interface LakeFeature {
  readonly properties: { readonly id: string; readonly name: string };
  readonly geometry: { readonly type: "MultiPolygon"; readonly coordinates: readonly (readonly (readonly (readonly number[])[])[])[] };
}
export interface BengaluruLayers {
  readonly drains: { readonly features: readonly DrainFeature[] };
  readonly lakes: { readonly features: readonly LakeFeature[] };
  readonly manifest: {
    readonly retrievedAt: string;
    readonly drainCounts: Readonly<Record<string, number>>;
    readonly lakeCount: number;
    readonly sources: readonly { readonly title: string; readonly datasetUrl: string; readonly resourceLastModified: string }[];
  };
}

let loaded: Promise<BengaluruLayers> | null = null;
export function loadBengaluruLayers(): Promise<BengaluruLayers> {
  if (!loaded) {
    const read = async (name: string) => {
      const response = await fetch(`${import.meta.env.BASE_URL}data/bengaluru/${name}`);
      if (!response.ok) throw new Error(`Cannot load Bengaluru ${name} (${response.status}).`);
      return response.json();
    };
    loaded = Promise.all([read("stormwater-drains.display.geojson"), read("lakes.display.geojson"), read("manifest.json")])
      .then(([drains, lakes, manifest]) => ({ drains, lakes, manifest } as BengaluruLayers));
    loaded.catch(() => { loaded = null; });
  }
  return loaded;
}
