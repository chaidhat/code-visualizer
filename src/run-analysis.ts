import { Worker } from "node:worker_threads";
import type { Snapshot, ReadProgress, AnalysisMessage } from "./model.js";

/** Keep compiler recursion and memory isolated from the terminal process. */
export function runAnalysis(
  input: string,
  onProgress?: (progress: ReadProgress) => void,
  signal?: AbortSignal,
): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Analysis cancelled."));
      return;
    }
    const worker = new Worker(
      new URL("./analysis-worker.js", import.meta.url),
      {
        workerData: input,
        execArgv: [],
        resourceLimits: { stackSizeMb: 16 },
      },
    );
    const abort = () => {
      void worker.terminate();
      reject(new Error("Analysis cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    let received = false;
    worker.on("message", (message: AnalysisMessage) => {
      if (signal?.aborted) return;
      if (message.type === "progress") {
        onProgress?.(message.progress);
      } else {
        received = true;
        resolve(message.snapshot);
      }
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      signal?.removeEventListener("abort", abort);
      if (!received)
        reject(
          new Error(
            `Analysis stopped before producing results (exit ${code}). Choose a smaller folder or check its source files.`,
          ),
        );
    });
  });
}
