import type {
  SimulationConfig,
  ValidateSimulationConfig,
  ValidationCode,
  ValidationIssue,
} from "../shared/simulation";

type Check = (value: unknown, path: string, issues: ValidationIssue[]) => void;
const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const child = (path: string, key: string): string =>
  `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;

function issue(issues: ValidationIssue[], code: ValidationCode, path: string, message: string): void {
  issues.push({ code, path, message });
}

const text: Check = (value, path, issues) => {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    issue(issues, "INVALID_SHAPE", path, "Expected a nonempty, trimmed string.");
  }
};

function choice(values: readonly string[], code: ValidationCode = "INVALID_SHAPE"): Check {
  return (value, path, issues) => {
    if (typeof value !== "string" || !values.includes(value)) {
      issue(issues, code, path, `Expected one of: ${values.join(", ")}.`);
    }
  };
}

function number(
  accepts: (value: number) => boolean = () => true,
  description = "a finite number",
  code: ValidationCode = "OUT_OF_RANGE",
): Check {
  return (value, path, issues) => {
    if (typeof value !== "number") issue(issues, "INVALID_SHAPE", path, "Expected a number.");
    else if (!Number.isFinite(value)) issue(issues, "NON_FINITE_NUMBER", path, "Number must be finite.");
    else if (!accepts(value)) issue(issues, code, path, `Expected ${description}.`);
  };
}

const finite = number();
const nonnegative = number((v) => v >= 0, "a nonnegative number");
const positive = number((v) => v > 0, "a number greater than zero");
const fraction = number((v) => v >= 0 && v <= 1, "a fraction between 0 and 1");
const time = number((v) => Number.isSafeInteger(v) && v >= 0, "nonnegative whole seconds", "INVALID_TIME");
const positiveTime = number((v) => Number.isSafeInteger(v) && v > 0, "positive whole seconds", "INVALID_TIME");

function object(fields: Readonly<Record<string, Check>>): Check {
  return (value, path, issues) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      issue(issues, "INVALID_SHAPE", path, "Expected a plain data object.");
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of Reflect.ownKeys(record)) {
      if (typeof key !== "string") {
        issue(issues, "INVALID_SHAPE", path, "Symbol properties are not supported.");
      } else if (!Object.hasOwn(fields, key)) {
        issue(issues, "INVALID_SHAPE", child(path, key), "Unknown property.");
      }
    }
    for (const [key, check] of Object.entries(fields)) {
      const at = child(path, key);
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        issue(issues, "INVALID_SHAPE", at, "A required plain data property is missing.");
      } else check(descriptor.value, at, issues);
    }
  };
}

function array(check: Check, minimum: number, maximum: number): Check {
  return (value, path, issues) => {
    if (!Array.isArray(value)) {
      issue(issues, "INVALID_SHAPE", path, "Expected an array.");
      return;
    }
    if (value.length < minimum) issue(issues, "OUT_OF_RANGE", path, `At least ${minimum} entry is required.`);
    if (value.length > maximum) {
      issue(issues, "RESOURCE_LIMIT_EXCEEDED", path, `At most ${maximum} entries are supported.`);
      return;
    }
    for (let i = 0; i < value.length; i += 1) check(value[i], `${path}/${i}`, issues);
  };
}

const intervention: Check = (value, path, issues) => {
  const kind = value !== null && typeof value === "object" && "kind" in value ? value.kind : undefined;
  const base = { id: text, regionId: text, timeS: time };
  if (kind === "set-drain-open-fraction") {
    object({ ...base, kind: choice([kind]), openFraction: fraction })(value, path, issues);
  } else if (kind === "set-pump-capacity" || kind === "set-drainage-capacity") {
    object({ ...base, kind: choice([kind]), capacityM3PerS: nonnegative })(value, path, issues);
  } else if (kind === "set-surface-outflow-factor") {
    object({ ...base, kind: choice([kind]), factor: fraction })(value, path, issues);
  } else issue(issues, "INVALID_SHAPE", `${path}/kind`, "Unsupported or missing intervention kind.");
};

const schema = object({
  contractVersion: choice(["1.0"], "UNSUPPORTED_CONTRACT_VERSION"),
  scenarioId: text,
  label: text,
  dataSource: choice(["synthetic", "user-provided"]),
  regions: array(object({
    id: text, label: text, center: object({ xM: finite, yM: finite }),
    areaM2: positive, terrainElevationM: finite, initialWaterDepthM: nonnegative,
    drainageCapacityM3PerS: nonnegative, initialDrainOpenFraction: fraction,
    initialPumpCapacityM3PerS: nonnegative,
  }), 1, 400),
  connections: array(object({
    id: text, regionAId: text, regionBId: text, conductanceM2PerS: nonnegative,
  }), 0, 1600),
  boundaryOutlets: array(object({
    id: text, regionId: text, externalWaterSurfaceElevationM: finite, conductanceM2PerS: nonnegative,
  }), 0, 800),
  rainfall: array(object({ startTimeS: time, endTimeS: time, intensityMmPerHour: nonnegative }), 1, 1000),
  interventions: array(intervention, 0, 1000),
  durationS: positiveTime,
  outputIntervalS: positiveTime,
  riskThresholds: object({ warningDepthM: positive, criticalDepthM: positive }),
  integration: object({
    maxStepS: positive,
    transferSafetyFactor: number((v) => v > 0 && v <= 0.5, "a factor greater than 0 and at most 0.5"),
    maxSteps: number((v) => Number.isSafeInteger(v) && v > 0, "a positive safe integer"),
    massBalanceAbsoluteToleranceM3: positive,
    massBalanceRelativeTolerance: nonnegative,
  }),
});

export const validateSimulationConfig: ValidateSimulationConfig = (input) => {
  const issues: ValidationIssue[] = [];
  schema(input, "", issues);
  const fail = () => ({
    ok: false as const,
    issues: issues.sort((a, b) => order(a.path, b.path) || order(a.code, b.code)),
  });
  if (issues.length) return fail();
  // All fields have now been checked; relationships are checked below.
  const config = input as SimulationConfig;
  const ids = new Set(config.regions.map((r) => r.id));
  function unique(entries: readonly { readonly id: string }[], path: string): void {
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      if (seen.has(entry.id)) issue(issues, "DUPLICATE_ID", `${path}/${i}/id`, `Duplicate ID: ${entry.id}.`);
      seen.add(entry.id);
    });
  }
  function reference(id: string, path: string): void {
    if (!ids.has(id)) issue(issues, "UNKNOWN_REGION", path, `Unknown region: ${id}.`);
  }
  unique(config.regions, "/regions");
  unique(config.connections, "/connections");
  unique(config.boundaryOutlets, "/boundaryOutlets");
  unique(config.interventions, "/interventions");
  const pairs = new Set<string>();
  config.connections.forEach((edge, i) => {
    reference(edge.regionAId, `/connections/${i}/regionAId`);
    reference(edge.regionBId, `/connections/${i}/regionBId`);
    if (edge.regionAId === edge.regionBId) issue(issues, "SELF_CONNECTION", `/connections/${i}`, "An edge needs two distinct regions.");
    const key = JSON.stringify([edge.regionAId, edge.regionBId].sort(order));
    if (pairs.has(key)) issue(issues, "DUPLICATE_CONNECTION", `/connections/${i}`, "Only one connection per unordered region pair is supported.");
    pairs.add(key);
  });
  config.boundaryOutlets.forEach((outlet, i) => reference(outlet.regionId, `/boundaryOutlets/${i}/regionId`));
  const eventKeys = new Set<string>();
  config.interventions.forEach((event, i) => {
    reference(event.regionId, `/interventions/${i}/regionId`);
    if (event.timeS >= config.durationS) issue(issues, "INVALID_TIME", `/interventions/${i}/timeS`, "Event must precede the simulation end.");
    const key = JSON.stringify([event.regionId, event.kind, event.timeS]);
    if (eventKeys.has(key)) issue(issues, "CONFLICTING_INTERVENTION", `/interventions/${i}`, "Two events change the same control at the same time.");
    eventKeys.add(key);
  });
  const rainfall = config.rainfall.map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.startTimeS - b.entry.startTimeS || a.index - b.index);
  let expectedStart = 0;
  for (const { entry, index } of rainfall) {
    if (entry.startTimeS !== expectedStart || entry.endTimeS <= entry.startTimeS || entry.endTimeS > config.durationS) {
      issue(issues, "INVALID_RAINFALL_PARTITION", `/rainfall/${index}`, "Rainfall must exactly cover the run without gaps, overlaps, or empty intervals.");
    }
    expectedStart = entry.endTimeS;
  }
  if (expectedStart !== config.durationS) issue(issues, "INVALID_RAINFALL_PARTITION", "/rainfall", "Rainfall must end at durationS.");
  if (config.riskThresholds.warningDepthM >= config.riskThresholds.criticalDepthM) {
    issue(issues, "INVALID_THRESHOLDS", "/riskThresholds", "Warning depth must be below critical depth.");
  }
  if (config.durationS > 86400) issue(issues, "RESOURCE_LIMIT_EXCEEDED", "/durationS", "Maximum supported duration is 86400 seconds.");
  if (config.integration.maxSteps > 1_000_000) issue(issues, "RESOURCE_LIMIT_EXCEEDED", "/integration/maxSteps", "Maximum supported step budget is 1000000.");
  if (Math.ceil(config.durationS / config.integration.maxStepS) > config.integration.maxSteps) {
    issue(issues, "RESOURCE_LIMIT_EXCEEDED", "/integration/maxSteps", "Step budget cannot cover this duration at maxStepS.");
  }
  if ((Math.ceil(config.durationS / config.outputIntervalS) + 1) * config.regions.length > 200000) {
    issue(issues, "RESOURCE_LIMIT_EXCEEDED", "/outputIntervalS", "Output would exceed 200000 saved region states; increase the interval.");
  }
  if (issues.length) return fail();
  return {
    ok: true,
    config: {
      ...config,
      regions: config.regions.map((r) => ({ ...r, center: { ...r.center } })).sort((a, b) => order(a.id, b.id)),
      connections: config.connections.map((e) => order(e.regionAId, e.regionBId) <= 0
        ? { ...e } : { ...e, regionAId: e.regionBId, regionBId: e.regionAId }).sort((a, b) => order(a.id, b.id)),
      boundaryOutlets: config.boundaryOutlets.map((b) => ({ ...b })).sort((a, b) => order(a.id, b.id)),
      rainfall: rainfall.map(({ entry }) => ({ ...entry })),
      interventions: config.interventions.map((e) => ({ ...e })).sort((a, b) => a.timeS - b.timeS
        || order(a.regionId, b.regionId) || order(a.kind, b.kind) || order(a.id, b.id)),
      riskThresholds: { ...config.riskThresholds },
      integration: { ...config.integration },
    },
  };
};
