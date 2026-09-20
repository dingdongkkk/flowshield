// Analytical checks for the simulation engine.
// Run from the project root: node src/simulation/verify.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const build = mkdtempSync(join(tmpdir(), 'flowshield-check-'));
let passed = 0;
try {
  execFileSync(resolve('node_modules/.bin/tsc'), [
    '--ignoreConfig',
    '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
    '--strict', '--noUncheckedIndexedAccess', '--skipLibCheck',
    '--types', 'vite/client',
    '--rootDir', 'src', '--outDir', build,
    'src/simulation/index.ts', 'src/app/scenarios.ts', 'src/app/comparison.ts', 'src/app/transport.ts', 'src/app/surrogate.ts',
  ], { stdio: 'inherit' });
  writeFileSync(join(build, 'package.json'), '{"type":"module"}');
  // Browser sources use bundler-style imports. Add extensions only to this
  // temporary emitted copy so Node can exercise exactly the compiled engine.
  for (const path of readdirSync(build, { recursive: true })) {
    if (path.endsWith('.js')) {
      const file = join(build, path);
      writeFileSync(file, readFileSync(file, 'utf8').replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
        (_, before, name, after) => `${before}${name.endsWith('.js') ? name : `${name}.js`}${after}`));
    }
  }
  const load = (name) => import(pathToFileURL(join(build, name)).href);
  const { simulateFlood, validateSimulationConfig } = await load('simulation/index.js');
  const { buildScenarioPair, DEFAULT_DRAFT, withScenarioHorizon, responseFootprint, pumpSites, detentionSites, BASIN_REGION_IDS } = await load('app/scenarios.js');
  const { inTrainingRange } = await load('app/surrogate.js');
  const { deriveComparison } = await load('app/comparison.js');
  const { checkSimulationRun } = await load('app/transport.js');
  const cell = (id, changes = {}) => ({
    id, label: id, center: { xM: 0, yM: 0 }, areaM2: 100,
    terrainElevationM: 0, initialWaterDepthM: 0,
    drainageCapacityM3PerS: 0, initialDrainOpenFraction: 1,
    initialPumpCapacityM3PerS: 0, ...changes,
  });
  const base = (changes = {}) => ({
    contractVersion: '1.0', scenarioId: 'check', label: 'Analytical check', dataSource: 'synthetic',
    regions: [cell('a')], connections: [], boundaryOutlets: [],
    rainfall: [{ startTimeS: 0, endTimeS: 100, intensityMmPerHour: 0 }],
    interventions: [], durationS: 100, outputIntervalS: 20,
    riskThresholds: { warningDepthM: 0.1, criticalDepthM: 0.3 },
    integration: { maxStepS: 1, transferSafetyFactor: 0.45, maxSteps: 1000000,
      massBalanceAbsoluteToleranceM3: 1e-6, massBalanceRelativeTolerance: 1e-9 }, ...changes,
  });
  const success = (config) => {
    const run = simulateFlood(config);
    assert.equal(run.status, 'success', JSON.stringify(run));
    checkSimulationRun(run);
    assert.deepEqual(JSON.parse(JSON.stringify(run)), run);
    return run.result;
  };
  const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance,
    `${actual} should equal ${expected} within ${tolerance}`);
  const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };
  const last = (r) => r.frames.at(-1);

  check('analytical rainfall units: 36 mm/h * 100 s * 100 m² = 0.1 m³', () => {
    const r = success(base({ rainfall: [{ startTimeS: 0, endTimeS: 100, intensityMmPerHour: 36 }] }));
    near(last(r).regions[0].waterVolumeM3, 0.1);
    near(last(r).regions[0].waterDepthM, 0.001);
    near(r.summary.finalBalance.rainfallInputM3, 0.1);
  });
  check('closed two-cell exchange conserves volume and flows down water-surface head', () => {
    const r = success(base({ regions: [cell('a', { initialWaterDepthM: 1 }), cell('b')],
      connections: [{ id: 'ab', regionAId: 'a', regionBId: 'b', conductanceM2PerS: 1 }] }));
    near(r.summary.finalBalance.storageM3, 100);
    assert.ok(last(r).regions[0].waterDepthM < 1);
    assert.ok(last(r).regions[1].waterDepthM > 0);
  });
  check('equal surfaces on different terrain remain at equilibrium', () => {
    const r = success(base({ regions: [cell('a', { terrainElevationM: 1, initialWaterDepthM: 1 }), cell('b', { initialWaterDepthM: 2 })],
      connections: [{ id: 'ab', regionAId: 'a', regionBId: 'b', conductanceM2PerS: 5 }] }));
    near(last(r).regions[0].waterDepthM, 1); near(last(r).regions[1].waterDepthM, 2);
  });
  check('combined sinks and lateral transfer share scarce donor water', () => {
    const c = base({ durationS: 1, outputIntervalS: 1,
      rainfall: [{ startTimeS: 0, endTimeS: 1, intensityMmPerHour: 0 }],
      regions: [cell('a', { initialWaterDepthM: 0.01, terrainElevationM: 1,
        drainageCapacityM3PerS: 4, initialPumpCapacityM3PerS: 3 }), cell('b')],
      connections: [{ id: 'ab', regionAId: 'a', regionBId: 'b', conductanceM2PerS: 2 }],
      boundaryOutlets: [{ id: 'out', regionId: 'a', externalWaterSurfaceElevationM: 0, conductanceM2PerS: 1 }],
    });
    const r = success(c); const factor = 1 / (4 + 3 + 2.02 + 1.01);
    near(r.summary.finalBalance.drainedM3, 4 * factor);
    near(r.summary.finalBalance.pumpedM3, 3 * factor);
    near(r.summary.finalBalance.boundaryDischargeM3, 1.01 * factor);
    near(last(r).regions[1].waterVolumeM3, 2.02 * factor);
    assert.ok(last(r).regions.every((x) => x.waterDepthM >= 0));
  });
  check('rain boundaries and timed pumps are not applied retroactively', () => {
    const r = success(base({ durationS: 10, outputIntervalS: 5,
      rainfall: [{ startTimeS: 0, endTimeS: 5, intensityMmPerHour: 3600 }, { startTimeS: 5, endTimeS: 10, intensityMmPerHour: 0 }],
      interventions: [{ id: 'pump', regionId: 'a', kind: 'set-pump-capacity', timeS: 5, capacityM3PerS: 0.02 }],
      integration: { ...base().integration, maxStepS: 10 },
    }));
    near(r.frames[1].regions[0].waterVolumeM3, 0.5);
    near(r.frames[1].regions[0].pumpCapacityM3PerS, 0.02);
    near(last(r).regions[0].waterVolumeM3, 0.4);
  });
  check('critical semantics: initial, between frames, equality, and horizon censoring', () => {
    const r = success(base({ durationS: 10, outputIntervalS: 10,
      regions: [cell('a', { areaM2: 1, initialWaterDepthM: 0.3 }), cell('b', { areaM2: 1 })],
      rainfall: [{ startTimeS: 0, endTimeS: 10, intensityMmPerHour: 360000 }],
    }));
    assert.equal(r.summary.regions[0].firstCritical.status, 'already-critical');
    assert.equal(r.summary.regions[1].firstCritical.status, 'reached');
    near(r.summary.regions[1].firstCritical.timeS, 3);
    assert.equal(success(base()).summary.regions[0].firstCritical.status, 'not-reached-within-horizon');
  });
  check('surface relaxation converges toward the two-cell analytical solution', () => {
    const error = (dt) => {
      const r = success(base({ regions: [cell('a', { initialWaterDepthM: 1 }), cell('b')],
        connections: [{ id: 'ab', regionAId: 'a', regionBId: 'b', conductanceM2PerS: 1 }],
        integration: { ...base().integration, maxStepS: dt },
      }));
      return Math.abs(last(r).regions[0].waterDepthM - (0.5 + 0.5 * Math.exp(-2)));
    };
    assert.ok(error(0.5) < error(1)); assert.ok(error(0.25) < error(0.5));
  });
  check('canonical ordering, reversed edges, repeat runs, and input immutability', () => {
    const c = base({ regions: [cell('b'), cell('a', { initialWaterDepthM: 1 })],
      connections: [{ id: 'ab', regionAId: 'b', regionBId: 'a', conductanceM2PerS: 1 }] });
    const before = JSON.stringify(c); const r = success(c);
    const reverse = structuredClone(c); reverse.regions.reverse();
    reverse.connections[0].regionAId = 'a'; reverse.connections[0].regionBId = 'b';
    assert.deepEqual(r, success(reverse)); assert.deepEqual(r, success(c));
    assert.equal(JSON.stringify(c), before);
    const validated = validateSimulationConfig(c); assert.equal(validated.ok, true);
    validated.config.regions[0].center.xM = 999;
    assert.equal(JSON.stringify(c), before);
  });
  check('outflow-only boundary never imports water', () => {
    const r = success(base({ boundaryOutlets: [{ id: 'out', regionId: 'a', externalWaterSurfaceElevationM: 100, conductanceM2PerS: 5 }] }));
    near(r.summary.finalBalance.storageM3, 0);
  });
  check('nondivisible output interval includes exact final time', () => {
    assert.deepEqual(success(base({ outputIntervalS: 30 })).frames.map((f) => f.timeS), [0, 30, 60, 90, 100]);
    assert.deepEqual(success(base({ outputIntervalS: 200 })).frames.map((f) => f.timeS), [0, 100]);
  });
  check('invalid values, topology, schedules, and conflicting events are structured failures', () => {
    for (const invalid of [null, {}, { ...base(), unexpected: 1 },
      base({ regions: [cell('a', { areaM2: 0 })] }),
      base({ regions: [cell('a', { terrainElevationM: NaN })] }),
      base({ connections: [{ id: 'e', regionAId: 'a', regionBId: 'missing', conductanceM2PerS: 1 }] }),
      base({ rainfall: [{ startTimeS: 1, endTimeS: 100, intensityMmPerHour: 0 }] }),
      base({ interventions: ['x', 'y'].map((id) => ({ id, regionId: 'a', kind: 'set-pump-capacity', timeS: 0, capacityM3PerS: 1 })) }),
    ]) assert.equal(simulateFlood(invalid).status, 'invalid-config');
  });
  check('finite input overflow and step exhaustion report failures, not partial success', () => {
    const bad = simulateFlood(base({ regions: [cell('a', { areaM2: 1e308, initialWaterDepthM: 1e308 })] }));
    assert.equal(bad.status, 'numerical-failure'); assert.equal(bad.error.code, 'NON_FINITE_STATE');
    const limited = simulateFlood(base({ regions: [cell('a'), cell('b')],
      connections: [{ id: 'ab', regionAId: 'a', regionBId: 'b', conductanceM2PerS: 1000 }],
      integration: { ...base().integration, maxSteps: 100 } }));
    assert.equal(limited.status, 'numerical-failure'); assert.equal(limited.error.code, 'STEP_LIMIT_EXCEEDED');
  });
  check('Opus default scenarios run and satisfy transport/comparison contracts', () => {
    const pair = buildScenarioPair(DEFAULT_DRAFT);
    const start = performance.now();
    const b = success(pair.baseline); const i = success(pair.intervention);
    const compare = deriveComparison(pair.baseline, b, pair.intervention, i);
    assert.equal(compare.ok, true);
    console.log(JSON.stringify({ defaultScenario: { elapsedMs: Math.round(performance.now() - start),
      baselinePeakM: b.summary.peakWaterDepthM, interventionPeakM: i.summary.peakWaterDepthM,
      baselineEverCritical: b.summary.everCriticalRegionCount,
      interventionEverCritical: i.summary.everCriticalRegionCount,
      residualM3: b.diagnostics.maxAbsolutePhysicalResidualM3 } }));
  });
  check('shorter horizons and replay exits keep actions valid and preserve clearing order', () => {
    const original = { ...DEFAULT_DRAFT, durationMin: 1080, pumpDeployMin: 900,
      basinDrainCondition: 'fails-mid-storm', drainFailureMin: 800, clearDrainsAtMin: 950 };
    const before = structuredClone(original);
    for (const horizon of [60, 120, 180, 240, 360]) {
      const d = withScenarioHorizon(original, horizon);
      assert.equal(d.pumpDeployMin, horizon - 5);
      assert.equal(d.clearDrainsAtMin, horizon - 5);
      assert.equal(d.drainFailureMin, horizon - 10);
      const pair = buildScenarioPair(d);
      assert.equal(validateSimulationConfig(pair.baseline).ok, true);
      assert.equal(validateSimulationConfig(pair.intervention).ok, true);
      assert.ok(pair.intervention.interventions.some((e) => e.id.startsWith('clear-')));
      if (horizon === 60) success(pair.intervention);
    }
    assert.deepEqual(original, before);
    assert.equal(withScenarioHorizon(DEFAULT_DRAFT, 60).clearDrainsAtMin, null);
    assert.deepEqual(withScenarioHorizon(DEFAULT_DRAFT, 180), DEFAULT_DRAFT);
    assert.equal(withScenarioHorizon(DEFAULT_DRAFT, 360).pumpDeployMin, 30);
    // Already invalid clearing order remains visibly ignored, not silently reordered.
    const invalidOrder = withScenarioHorizon({ ...original, drainFailureMin: 40, clearDrainsAtMin: 30 }, 60);
    assert.equal(invalidOrder.clearDrainsAtMin, 30);
    assert.equal(invalidOrder.drainFailureMin, 40);
  });
  check('AI rejects unsupported numbers, settings and active schedule bounds', () => {
    assert.equal(inTrainingRange(DEFAULT_DRAFT).ok, true);
    assert.equal(inTrainingRange({ ...DEFAULT_DRAFT, pumpCount: 10 }).ok, true);
    for (const patch of [
      { pumpCount: 11 }, { pumpCount: 47 }, { pumpCount: 1.5 }, { pumpCount: NaN },
      { peakIntensityMmPerHour: 201 }, { peakIntensityMmPerHour: Infinity },
      { stormDurationMin: 181 }, { stormDurationMin: 0 }, { durationMin: 90 },
      { drainDesignMmPerHour: 61 }, { pumpCapacityM3PerS: 2 },
      { detentionShare: 0.8 }, { detentionHoldPct: 100 }, { drainUpgradeFactor: 5 },
      { pumpDeployMin: 175 }, { pumpDeployMin: NaN },
      { basinDrainCondition: 'fails-mid-storm', drainFailureMin: 175 },
      { basinDrainCondition: 'blocked', clearDrainsAtMin: 0 },
      { storm: 'event-2022' }, { criticalDepthM: 0.4 }, { conductanceScale: 2 }, { maxStepS: 0.5 },
    ]) assert.equal(inTrainingRange({ ...DEFAULT_DRAFT, ...patch }).ok, false, JSON.stringify(patch));
    assert.equal(inTrainingRange({ ...DEFAULT_DRAFT, pumpCount: 0, pumpDeployMin: 175 }).ok, true);
  });
  check('plan footprint counts overlapping structural measures once', () => {
    const d = { ...DEFAULT_DRAFT, detentionShare: 0, pumpCount: 3 };
    assert.ok(pumpSites(3).every((id) => BASIN_REGION_IDS.has(id)));
    assert.equal(responseFootprint(d), BASIN_REGION_IDS.size);
    assert.equal(responseFootprint({ ...d, drainUpgradeFactor: 1 }), 3);
    assert.equal(responseFootprint({ ...d, pumpCount: 0, drainUpgradeFactor: 1 }), 0);
    const expected = new Set([...BASIN_REGION_IDS, ...pumpSites(3), ...detentionSites(0.6)]).size;
    assert.equal(responseFootprint(DEFAULT_DRAFT), expected);
    assert.equal(responseFootprint({ ...d, drainDesignMmPerHour: 0 }), 3);
  });
  check('timed drain upgrades replace capacity, respect blockage and conserve volume', () => {
    const r = success(base({ durationS: 10, outputIntervalS: 5,
      regions: [cell('a', { initialWaterDepthM: 2, drainageCapacityM3PerS: 1, initialDrainOpenFraction: 0.5 })],
      rainfall: [{ startTimeS: 0, endTimeS: 10, intensityMmPerHour: 0 }],
      interventions: [{ id: 'upgrade', regionId: 'a', timeS: 5, kind: 'set-drainage-capacity', capacityM3PerS: 3 }],
    }));
    near(r.frames[1].regions[0].waterVolumeM3, 197.5);
    near(r.frames[1].regions[0].drainageCapacityM3PerS, 3);
    near(r.summary.finalBalance.drainedM3, 10);
    near(r.summary.finalBalance.storageM3, 190);
  });
  check('full detention stops surface exports but leaves drains and pumps active', () => {
    const r = success(base({ regions: [cell('a', { initialWaterDepthM: 1, drainageCapacityM3PerS: 0.1, initialPumpCapacityM3PerS: 0.2 }), cell('b')],
      connections: [{ id: 'ab', regionAId: 'a', regionBId: 'b', conductanceM2PerS: 1 }],
      boundaryOutlets: [{ id: 'out', regionId: 'a', externalWaterSurfaceElevationM: 0, conductanceM2PerS: 1 }],
      interventions: [{ id: 'hold', regionId: 'a', timeS: 0, kind: 'set-surface-outflow-factor', factor: 0 }],
    }));
    near(last(r).regions[1].waterVolumeM3, 0);
    near(r.summary.finalBalance.boundaryDischargeM3, 0);
    near(r.summary.finalBalance.drainedM3, 10);
    near(r.summary.finalBalance.pumpedM3, 20);
    near(r.summary.finalBalance.storageM3, 70);
  });
  check('timed detention release applies only after its boundary', () => {
    const r = success(base({ durationS: 10, outputIntervalS: 5,
      regions: [cell('a', { initialWaterDepthM: 1 }), cell('b')],
      rainfall: [{ startTimeS: 0, endTimeS: 10, intensityMmPerHour: 0 }],
      connections: [{ id: 'ab', regionAId: 'a', regionBId: 'b', conductanceM2PerS: 1 }],
      interventions: [
        { id: 'hold', regionId: 'a', timeS: 0, kind: 'set-surface-outflow-factor', factor: 0 },
        { id: 'release', regionId: 'a', timeS: 5, kind: 'set-surface-outflow-factor', factor: 1 },
      ],
    }));
    near(r.frames[1].regions[1].waterVolumeM3, 0);
    near(r.frames[1].regions[0].surfaceOutflowFactor, 1);
    assert.ok(last(r).regions[1].waterVolumeM3 > 0);
    near(r.summary.finalBalance.storageM3, 100);
  });
  check('detention and upgrades share scarce water with every other export', () => {
    const r = success(base({ durationS: 1, outputIntervalS: 1,
      rainfall: [{ startTimeS: 0, endTimeS: 1, intensityMmPerHour: 0 }],
      regions: [cell('a', { initialWaterDepthM: 0.01, terrainElevationM: 1, initialPumpCapacityM3PerS: 3 }), cell('b')],
      connections: [{ id: 'ab', regionAId: 'a', regionBId: 'b', conductanceM2PerS: 2 }],
      boundaryOutlets: [{ id: 'out', regionId: 'a', externalWaterSurfaceElevationM: 0, conductanceM2PerS: 1 }],
      interventions: [
        { id: 'hold', regionId: 'a', timeS: 0, kind: 'set-surface-outflow-factor', factor: 0.5 },
        { id: 'upgrade', regionId: 'a', timeS: 0, kind: 'set-drainage-capacity', capacityM3PerS: 4 },
      ],
    }));
    const scale = 1 / (4 + 3 + 1.01 + 0.505);
    near(r.summary.finalBalance.drainedM3, 4 * scale);
    near(r.summary.finalBalance.pumpedM3, 3 * scale);
    near(r.summary.finalBalance.boundaryDischargeM3, 0.505 * scale);
    near(last(r).regions[1].waterVolumeM3, 1.01 * scale);
    near(last(r).regions[0].waterVolumeM3, 0);
  });
  check('invalid detention factors and drain capacities are rejected', () => {
    for (const event of [
      { kind: 'set-surface-outflow-factor', factor: -0.1 },
      { kind: 'set-surface-outflow-factor', factor: 1.1 },
      { kind: 'set-surface-outflow-factor', factor: NaN },
      { kind: 'set-drainage-capacity', capacityM3PerS: -1 },
      { kind: 'set-drainage-capacity', capacityM3PerS: Infinity },
    ]) assert.equal(simulateFlood(base({ interventions: [{ id: 'bad', regionId: 'a', timeS: 0, ...event }] })).status, 'invalid-config');
  });
  console.log(`${passed} engine and integration checks passed.`);
} finally {
  rmSync(build, { recursive: true, force: true });
}
