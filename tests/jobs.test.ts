import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createProject,
  getProject,
  sourceSnippet,
  cancel,
} from "../src/server/jobs";
async function complete(id: string) {
  for (let i = 0; i < 200; i++) {
    const job = getProject(id);
    if (job.state !== "running") {
      assert.equal(job.state, "complete", job.error);
      return job;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Test analysis did not finish");
}
test("worker completion, source snapshots, traversal, links, removed files and cancellation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "visualizer-job-"));
  try {
    const file = path.join(root, "main.ts");
    await fs.writeFile(file, "function run() {}\nrun();");
    let job = await createProject(root);
    await complete(job.id);
    assert.match((await sourceSnippet(job.id, "main.ts", 2, 2)).text, /run/);
    await assert.rejects(sourceSnippet(job.id, "../outside.ts", 1, 1));
    await assert.rejects(sourceSnippet(job.id, "main.ts", 1, 99999));
    await fs.writeFile(file, "function changed() {}");
    await assert.rejects(
      sourceSnippet(job.id, "main.ts", 1, 1),
      /changed after analysis/,
    );
    await fs.unlink(file);
    await fs.symlink("/etc/hosts", file);
    await assert.rejects(sourceSnippet(job.id, "main.ts", 1, 1), /outside/);
    await fs.unlink(file);
    await assert.rejects(sourceSnippet(job.id, "main.ts", 1, 1));
    await fs.writeFile(file, "function run() {}\nrun();");
    const previous = job.id;
    job = await createProject(root);
    assert.throws(() => getProject(previous));
    await cancel(job.id);
    assert.equal(getProject(job.id).state, "cancelled");
    assert.equal(getProject(job.id).worker, undefined);
    assert.equal(getProject(job.id).graph, undefined);
    job = await createProject(root);
    const worker = getProject(job.id).worker!;
    await worker.terminate();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(getProject(job.id).state, "failed");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
