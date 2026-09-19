import type {
  SimulationConfig,
  SimulationRun,
  SimulationWorkerRequest,
} from "../shared/simulation";
import { parseWorkerResponse } from "./transport";

export type RunOutcome =
  | { readonly kind: "completed"; readonly requestId: string; readonly run: SimulationRun }
  | { readonly kind: "app-error"; readonly requestId: string; readonly message: string }
  | { readonly kind: "cancelled"; readonly requestId: string };

interface Pending {
  readonly requestId: string;
  readonly resolve: (outcome: RunOutcome) => void;
}

/**
 * Owns one worker. The engine is synchronous, so a running request cannot see
 * a cancel message: cancelling terminates the worker and the next run starts a
 * fresh one. Replies whose requestId is not the pending one are ignored.
 */
export class SimulationClient {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private sequence = 0;

  constructor(private readonly name: string) {}

  get busy(): boolean {
    return this.pending !== null;
  }

  run(config: SimulationConfig): { requestId: string; outcome: Promise<RunOutcome> } {
    this.cancel();
    this.sequence += 1;
    const requestId = `${this.name}-${this.sequence}-${Date.now().toString(36)}`;
    const outcome = new Promise<RunOutcome>((resolve) => {
      this.pending = { requestId, resolve };
    });
    const request: SimulationWorkerRequest = { type: "run", requestId, config };
    try {
      this.ensureWorker().postMessage(request);
    } catch (err) {
      this.finish({ kind: "app-error", requestId, message: `Could not send config: ${String(err)}` });
      this.discardWorker();
    }
    return { requestId, outcome };
  }

  cancel(): void {
    if (!this.pending) return;
    const { requestId } = this.pending;
    this.discardWorker();
    this.finish({ kind: "cancelled", requestId });
  }

  dispose(): void {
    this.cancel();
    this.discardWorker();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("../workers/simulation.worker.ts", import.meta.url), {
      type: "module",
      name: `flowshield-${this.name}`,
    });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (worker !== this.worker || !this.pending) return;
      const parsed = parseWorkerResponse(event.data);
      const pendingId = this.pending.requestId;
      if (parsed.ok) {
        const { response } = parsed;
        if (response.requestId !== pendingId) return; // stale reply
        this.finish(
          response.type === "completed"
            ? { kind: "completed", requestId: pendingId, run: response.run }
            : { kind: "app-error", requestId: pendingId, message: `Worker error: ${response.message}` },
        );
      } else {
        if (parsed.requestId !== null && parsed.requestId !== pendingId) return;
        this.finish({
          kind: "app-error",
          requestId: pendingId,
          message: `Engine output violated the 1.0 contract: ${parsed.error}`,
        });
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      if (worker !== this.worker) return;
      const pendingId = this.pending?.requestId;
      this.discardWorker();
      if (pendingId) {
        this.finish({ kind: "app-error", requestId: pendingId, message: `Worker crashed: ${event.message || "unknown error"}` });
      }
    };
    worker.onmessageerror = () => {
      if (worker !== this.worker || !this.pending) return;
      this.finish({ kind: "app-error", requestId: this.pending.requestId, message: "Worker message could not be deserialized." });
    };
    this.worker = worker;
    return worker;
  }

  private discardWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private finish(outcome: RunOutcome): void {
    const pending = this.pending;
    if (!pending || pending.requestId !== outcome.requestId) return;
    this.pending = null;
    pending.resolve(outcome);
  }
}
