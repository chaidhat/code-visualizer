import { parentPort, workerData } from "node:worker_threads";
import { analyze } from "./graph";
try {
  parentPort!.postMessage({
    type: "complete",
    graph: analyze(workerData.root, (progress) =>
      parentPort!.postMessage({ type: "progress", progress }),
    ),
  });
} catch {
  parentPort!.postMessage({
    type: "failed",
    error: "Analysis failed. Check that the folder is readable and try again.",
  });
}
