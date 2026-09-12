import { Worker } from "node:worker_threads";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { Graph, JobStatus } from "../shared/graph";
import { contained, MAX_FILE } from "./analysis/discover";
type Job = JobStatus & {
  root: string;
  graph?: Graph;
  worker?: Worker;
  timer?: ReturnType<typeof setTimeout>;
  touched: number;
};
const state = globalThis as typeof globalThis & {
  visualizerJobs?: Map<string, Job>;
  visualizerCleanup?: ReturnType<typeof setInterval>;
};
const jobs = (state.visualizerJobs ??= new Map<string, Job>());
function release(job: Job) {
  if (job.timer) clearTimeout(job.timer);
  const worker = job.worker;
  job.worker = undefined;
  job.graph = undefined;
  return worker?.terminate();
}
if (!state.visualizerCleanup) {
  state.visualizerCleanup = setInterval(() => {
    for (const [id, job] of jobs)
      if (Date.now() - job.touched > 30 * 60 * 1000) {
        void release(job);
        jobs.delete(id);
      }
  }, 60000);
  state.visualizerCleanup.unref();
}
export async function createProject(input: string) {
  if (!path.isAbsolute(input))
    throw new Error("Enter an absolute folder path.");
  const root = await fs.realpath(input);
  if (!(await fs.stat(root)).isDirectory()) throw new Error("Choose a folder.");
  // Serialize launches so only one analysis worker holds a project at a time.
  for (const old of jobs.values()) {
    await release(old);
    old.state = "cancelled";
  }
  jobs.clear();
  const id = randomUUID();
  const job: Job = {
    id,
    root,
    label: path.basename(root) || root,
    layoutKey: createHash("sha256").update(root).digest("hex").slice(0, 24),
    state: "running",
    progress: "Discovering files",
    touched: Date.now(),
  };
  jobs.set(id, job);
  const worker = new Worker(path.join(process.cwd(), "dist/analysis.cjs"), {
    workerData: { root },
    resourceLimits: { maxOldGenerationSizeMb: 1024 },
  });
  job.worker = worker;
  worker.on("message", (message) => {
    if (job.state !== "running") return;
    if (message.type === "progress") job.progress = message.progress;
    if (message.type === "complete") {
      job.graph = message.graph;
      job.state = "complete";
      job.progress = "Snapshot ready";
      if (job.timer) clearTimeout(job.timer);
    }
    if (message.type === "failed") {
      job.state = "failed";
      job.error = message.error;
    }
  });
  worker.on("error", () => {
    if (job.state === "running") {
      job.state = "failed";
      job.error = "The analysis worker stopped unexpectedly.";
    }
  });
  worker.on("exit", () => {
    job.worker = undefined;
    if (job.timer) clearTimeout(job.timer);
    if (job.state === "running") {
      job.state = "failed";
      job.error = "Analysis ended before a snapshot was ready.";
    }
  });
  job.timer = setTimeout(() => {
    if (job.state === "running") {
      job.state = "failed";
      job.error = "Analysis exceeded the processing limit.";
      void release(job);
    }
  }, 300000);
  job.timer.unref();
  return status(job);
}
export function getProject(id: string) {
  const job = jobs.get(id);
  if (!job)
    throw new Error(
      "This project is no longer available. Select the folder again.",
    );
  job.touched = Date.now();
  return job;
}
export function status(job: Job): JobStatus {
  const { id, label, layoutKey, state, progress, error } = job;
  return { id, label, layoutKey, state, progress, error };
}
export async function cancel(id: string) {
  const job = getProject(id);
  job.state = "cancelled";
  await release(job);
  return status(job);
}
export async function sourceSnippet(
  id: string,
  file: string,
  start: number,
  end: number,
) {
  const job = getProject(id);
  const entry = job.graph?.files.find((f) => f.path === file && f.supported);
  if (
    !entry ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < start ||
    end - start > 200
  )
    throw new Error("Source request is outside the allowed range.");
  const actual = await fs.realpath(path.resolve(job.root, file));
  if (!contained(job.root, actual))
    throw new Error("Source is outside the selected folder.");
  const handle = await fs.open(
    actual,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE)
      throw new Error("Source is unavailable.");
    // Read a fixed maximum even if the file grows after stat.
    const buffer = Buffer.alloc(MAX_FILE + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_FILE) throw new Error("Source exceeds the size limit.");
    const content = buffer.subarray(0, bytesRead).toString("utf8");
    if (createHash("sha256").update(content).digest("hex") !== entry.digest)
      throw new Error(
        "This file changed after analysis. Refresh the map to inspect current source.",
      );
    const lines = content.split("\n");
    const from = Math.max(1, start - 3);
    const to = Math.min(lines.length, end + 3);
    return { file, start: from, text: lines.slice(from - 1, to).join("\n") };
  } finally {
    await handle.close();
  }
}
