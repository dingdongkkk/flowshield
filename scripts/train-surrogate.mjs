// Trains FlowShield's AI surrogate on real engine runs.
// Run from the project root:  node scripts/train-surrogate.mjs [samples]
// Output: src/data/surrogate-model.json (weights, normalisation, held-out metrics).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const OUTPUT_KEYS = ["peakDepthM", "criticalShare", "earliestCriticalShare", "storedShare", "buildingsCriticalShare"];

// ---------- compile the TypeScript engine + app modules once ----------
function compile() {
  const build = mkdtempSync(join(tmpdir(), "flowshield-train-"));
  execFileSync(resolve("node_modules/.bin/tsc"), [
    "--ignoreConfig", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler",
    "--strict", "--skipLibCheck", "--types", "vite/client", "--rootDir", "src", "--outDir", build,
    "src/simulation/index.ts", "src/app/scenarios.ts", "src/app/surrogate.ts", "src/data/bengaluru-exposure.ts",
  ], { stdio: "inherit" });
  writeFileSync(join(build, "package.json"), '{"type":"module"}');
  for (const path of readdirSync(build, { recursive: true })) {
    if (!String(path).endsWith(".js")) continue;
    const file = join(build, String(path));
    writeFileSync(file, readFileSync(file, "utf8").replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
      (_, a, name, b) => `${a}${name.endsWith(".js") ? name : `${name}.js`}${b}`));
  }
  return build;
}

// ---------- deterministic random scenarios ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function sampleDraft(base, r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const durationMin = pick([60, 120, 180, 240, 360]);
  const stormDurationMin = Math.min(durationMin, 15 * (1 + Math.floor(r() * 16)));
  const upTo = (max) => Math.max(0, Math.floor(r() * (max / 5)) * 5);
  const condition = pick(["working", "working", "partly-blocked", "blocked", "fails-mid-storm"]);
  return {
    ...base,
    storm: pick(["steady", "heavy", "cloudburst"]),
    peakIntensityMmPerHour: Math.round(5 + 195 * r() ** 1.6),
    stormDurationMin, durationMin,
    drainDesignMmPerHour: 5 * Math.floor(r() * 13),
    basinDrainCondition: condition,
    drainFailureMin: upTo(durationMin - 5),
    pumpCount: r() < 0.4 ? 0 : 1 + Math.floor(r() * 10),
    pumpCapacityM3PerS: Math.round((0.05 + 1.45 * r()) * 20) / 20,
    pumpDeployMin: upTo(durationMin - 5),
    clearDrainsAtMin: condition !== "working" && r() < 0.6 ? 5 + upTo(durationMin - 10) : null,
    detentionShare: r() < 0.4 ? 0 : Math.round(r() * 7) / 10,
    detentionHoldPct: 10 + 5 * Math.floor(r() * 18),
    drainUpgradeFactor: r() < 0.4 ? 1 : 1 + Math.round(r() * 6) / 2,
  };
}

// ---------- worker: run the engine ----------
if (!isMainThread) {
  const { build, drafts } = workerData;
  const url = (p) => pathToFileURL(join(build, p)).href;
  const { simulateFlood } = await import(url("simulation/index.js"));
  const { buildScenarioPair } = await import(url("app/scenarios.js"));
  const { BENGALURU_EXPOSURE } = await import(url("data/bengaluru-exposure.js"));
  const buildings = BENGALURU_EXPOSURE.buildingsByCell;
  for (const draft of drafts) {
    const config = buildScenarioPair(draft).intervention;
    const run = simulateFlood(config);
    if (run.status !== "success") { parentPort.postMessage({ draft, error: run.status, detail: JSON.stringify(run.issues ?? run.error).slice(0, 300) }); continue; }
    const s = run.result.summary;
    const times = s.regions.map((x) => x.firstCritical.status === "not-reached-within-horizon" ? null
      : x.firstCritical.status === "already-critical" ? 0 : x.firstCritical.timeS).filter((t) => t !== null);
    const critical = s.regions.filter((x) => x.firstCritical.status !== "not-reached-within-horizon");
    parentPort.postMessage({
      draft,
      y: [
        s.peakWaterDepthM,
        s.everCriticalRegionCount / s.regions.length,
        times.length ? Math.min(...times) / config.durationS : 1,
        s.finalBalance.storageM3 / Math.max(1, s.finalBalance.rainfallInputM3 + s.finalBalance.initialStorageM3),
        critical.reduce((sum, x) => sum + (buildings[x.regionId] ?? 0), 0) / BENGALURU_EXPOSURE.totalBuildings,
      ],
    });
  }
  process.exit(0);
}

// ---------- tiny MLP with Adam ----------
function makeLayer(inN, outN, r) {
  const scale = Math.sqrt(1 / inN);
  return { in: inN, out: outN, w: Array.from({ length: inN * outN }, () => (r() * 2 - 1) * scale * 1.7), b: new Array(outN).fill(0) };
}

function train(X, Y, { hidden = [48, 48], epochs = 600, lr = 3e-3, batch = 64, seed = 7 } = {}) {
  const r = rng(seed);
  const sizes = [X[0].length, ...hidden, Y[0].length];
  const layers = sizes.slice(1).map((n, i) => makeLayer(sizes[i], n, r));
  const m = layers.map((l) => ({ w: new Float64Array(l.w.length), b: new Float64Array(l.b.length) }));
  const v = layers.map((l) => ({ w: new Float64Array(l.w.length), b: new Float64Array(l.b.length) }));
  let t = 0;
  const order = X.map((_, i) => i);
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (let i = order.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const rate = lr * (epoch < epochs * 0.7 ? 1 : 0.2);
    for (let start = 0; start < order.length; start += batch) {
      const idx = order.slice(start, start + batch);
      const gw = layers.map((l) => new Float64Array(l.w.length));
      const gb = layers.map((l) => new Float64Array(l.b.length));
      for (const k of idx) {
        const acts = [X[k]];
        for (let li = 0; li < layers.length; li += 1) {
          const l = layers[li]; const a = acts[li]; const z = new Array(l.out);
          for (let o = 0; o < l.out; o += 1) { let s = l.b[o]; for (let i = 0; i < l.in; i += 1) s += l.w[o * l.in + i] * a[i]; z[o] = li < layers.length - 1 ? Math.tanh(s) : s; }
          acts.push(z);
        }
        let delta = acts[layers.length].map((p, o) => (2 * (p - Y[k][o])) / idx.length);
        for (let li = layers.length - 1; li >= 0; li -= 1) {
          const l = layers[li]; const a = acts[li];
          const prev = new Array(l.in).fill(0);
          for (let o = 0; o < l.out; o += 1) {
            gb[li][o] += delta[o];
            for (let i = 0; i < l.in; i += 1) { gw[li][o * l.in + i] += delta[o] * a[i]; prev[i] += delta[o] * l.w[o * l.in + i]; }
          }
          if (li > 0) delta = prev.map((g, i) => g * (1 - a[i] * a[i]));
        }
      }
      t += 1;
      layers.forEach((l, li) => {
        for (const [p, g, mm, vv] of [[l.w, gw[li], m[li].w, v[li].w], [l.b, gb[li], m[li].b, v[li].b]]) {
          for (let i = 0; i < p.length; i += 1) {
            mm[i] = 0.9 * mm[i] + 0.1 * g[i];
            vv[i] = 0.999 * vv[i] + 0.001 * g[i] * g[i];
            p[i] -= (rate * (mm[i] / (1 - 0.9 ** t))) / (Math.sqrt(vv[i] / (1 - 0.999 ** t)) + 1e-8);
          }
        }
      });
    }
  }
  return layers;
}

function forward(layers, x) {
  let a = x;
  layers.forEach((l, li) => {
    const z = new Array(l.out);
    for (let o = 0; o < l.out; o += 1) { let s = l.b[o]; for (let i = 0; i < l.in; i += 1) s += l.w[o * l.in + i] * a[i]; z[o] = li < layers.length - 1 ? Math.tanh(s) : s; }
    a = z;
  });
  return a;
}

// ---------- main ----------
const total = Number(process.argv[2] ?? 3000);
const build = compile();
const { DEFAULT_DRAFT } = await import(pathToFileURL(join(build, "app/scenarios.js")).href);
const { features } = await import(pathToFileURL(join(build, "app/surrogate.js")).href);
const r = rng(20260919);
const drafts = Array.from({ length: total }, () => sampleDraft(DEFAULT_DRAFT, r));
const threads = Math.max(1, availableParallelism() - 1);
const rows = [];
const started = Date.now();
await Promise.all(Array.from({ length: threads }, (_, w) => new Promise((done, fail) => {
  const worker = new Worker(new URL(import.meta.url), { workerData: { build, drafts: drafts.filter((_, i) => i % threads === w) } });
  worker.on("message", (row) => { rows.push(row); if (rows.length % 250 === 0) console.log(`${rows.length}/${total} runs (${Math.round((Date.now() - started) / 1000)} s)`); });
  worker.on("error", fail);
  worker.on("exit", done);
})));
const good = rows.filter((row) => row.y);
for (const row of rows.filter((x) => x.error).slice(0, 3)) console.log("failure:", row.error, row.detail, JSON.stringify(row.draft).slice(0, 200));
console.log(`${good.length} successful runs, ${rows.length - good.length} failures, ${Math.round((Date.now() - started) / 1000)} s`);

// Deterministic split by sample order (drafts are already random).
good.sort((a, b) => JSON.stringify(a.draft) < JSON.stringify(b.draft) ? -1 : 1);
const testEvery = 7; // ~14% held out
const trainRows = good.filter((_, i) => i % testEvery !== 0);
const testRows = good.filter((_, i) => i % testEvery === 0);
const Xraw = trainRows.map((row) => features(row.draft));
const nF = Xraw[0].length;
const fMean = Array.from({ length: nF }, (_, j) => Xraw.reduce((s, x) => s + x[j], 0) / Xraw.length);
const fStd = Array.from({ length: nF }, (_, j) => Math.sqrt(Xraw.reduce((s, x) => s + (x[j] - fMean[j]) ** 2, 0) / Xraw.length) || 1);
const tMean = OUTPUT_KEYS.map((_, j) => trainRows.reduce((s, row) => s + row.y[j], 0) / trainRows.length);
const tStd = OUTPUT_KEYS.map((_, j) => Math.sqrt(trainRows.reduce((s, row) => s + (row.y[j] - tMean[j]) ** 2, 0) / trainRows.length) || 1);
const norm = (x) => x.map((v, j) => (v - fMean[j]) / fStd[j]);
const X = Xraw.map(norm);
const Y = trainRows.map((row) => row.y.map((v, j) => (v - tMean[j]) / tStd[j]));
const layers = train(X, Y);

const metrics = {};
OUTPUT_KEYS.forEach((key, j) => {
  const pairs = testRows.map((row) => [row.y[j], forward(layers, norm(features(row.draft)))[j] * tStd[j] + tMean[j]]);
  const mean = pairs.reduce((s, [y]) => s + y, 0) / pairs.length;
  const sse = pairs.reduce((s, [y, p]) => s + (y - p) ** 2, 0);
  const sst = pairs.reduce((s, [y]) => s + (y - mean) ** 2, 0);
  metrics[key] = { mae: pairs.reduce((s, [y, p]) => s + Math.abs(y - p), 0) / pairs.length, r2: 1 - sse / sst };
});
console.table(metrics);

const model = {
  version: 1, trainedAt: new Date().toISOString(),
  samples: { train: trainRows.length, test: testRows.length },
  featureNames: ["storm:steady", "storm:heavy", "storm:cloudburst", "peakIntensity", "stormLength", "horizon", "stormShare",
    "rainDepthProxy", "drainDesign", "district:working", "district:partly-blocked", "district:blocked", "district:fails-mid-storm",
    "failureTime", "pumpTotal", "pumpDeployTime", "clearTime", "detentionShare", "detentionHold", "detentionEffort", "drainUpgrade"],
  featureMean: fMean, featureStd: fStd, targetMean: tMean, targetStd: tStd,
  layers: layers.map((l) => ({ in: l.in, out: l.out, w: l.w.map((x) => +x.toPrecision(6)), b: l.b.map((x) => +x.toPrecision(6)) })),
  metrics,
  validity: "Design storms (steady/heavy/cloudburst), 5-200 mm/h, 1-6 h, default 10/30 cm thresholds and conductance.",
};
writeFileSync("src/data/surrogate-model.json", JSON.stringify(model));
console.log("wrote src/data/surrogate-model.json");
