import { parentPort, workerData } from "node:worker_threads";
import type { AnalysisMessage } from "./model.js";
import { cachedAnalysis } from "./analysis-cache.js";

if (!parentPort || typeof workerData !== "string") {
  throw new Error("Analysis must be started with a selected path.");
}
const port = parentPort;
const send = (message: AnalysisMessage) => port.postMessage(message);
let lastUpdate = 0;
const snapshot = cachedAnalysis(workerData, (progress) => {
  const now = performance.now();
  if (
    progress.read === 0 ||
    progress.read === progress.total ||
    now - lastUpdate >= 50
  ) {
    lastUpdate = now;
    send({ type: "progress", progress });
  }
});
send({ type: "result", snapshot });
