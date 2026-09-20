/// <reference lib="webworker" />
import type {
  SimulateFlood,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "../shared/simulation";

// The glob resolves to an empty object if src/simulation/index.ts is missing, so
// the app still builds and reports the missing engine rather than inventing a result.
const engineModules = import.meta.glob<{ simulateFlood?: SimulateFlood }>(
  "../simulation/index.ts",
);

let enginePromise: Promise<SimulateFlood> | null = null;

function loadEngine(): Promise<SimulateFlood> {
  if (!enginePromise) {
    const loader = Object.values(engineModules)[0];
    enginePromise = loader
      ? loader().then((mod) => {
          if (typeof mod.simulateFlood !== "function") {
            throw new Error("src/simulation/index.ts does not export simulateFlood.");
          }
          return mod.simulateFlood;
        })
      : Promise.reject(
          new Error("Simulation engine not available yet (src/simulation/index.ts is missing)."),
        );
    // Allow a later request to retry after a failed load.
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(response: SimulationWorkerResponse): void {
  try {
    scope.postMessage(response);
  } catch (err) {
    // e.g. DataCloneError: never let an uncloneable result disappear silently.
    scope.postMessage({
      type: "worker-error",
      requestId: response.requestId,
      message: `Could not transfer result: ${describe(err)}`,
    } satisfies SimulationWorkerResponse);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readRequest(data: unknown): SimulationWorkerRequest | { requestId: string; error: string } {
  if (typeof data !== "object" || data === null) {
    return { requestId: "", error: "Request is not an object." };
  }
  const record = data as Record<string, unknown>;
  const requestId = typeof record.requestId === "string" ? record.requestId : "";
  if (record.type !== "run") return { requestId, error: "Unsupported request type." };
  if (requestId === "") return { requestId, error: "Request is missing requestId." };
  if (typeof record.config !== "object" || record.config === null) {
    return { requestId, error: "Request is missing config." };
  }
  // Config content is validated by the engine (simulateFlood revalidates).
  return data as SimulationWorkerRequest;
}

scope.onmessage = async (event: MessageEvent<unknown>) => {
  const request = readRequest(event.data);
  if ("error" in request) {
    post({ type: "worker-error", requestId: request.requestId, message: request.error });
    return;
  }
  try {
    const simulateFlood = await loadEngine();
    const run = simulateFlood(request.config);
    post({ type: "completed", requestId: request.requestId, run });
  } catch (err) {
    post({ type: "worker-error", requestId: request.requestId, message: describe(err) });
  }
};
