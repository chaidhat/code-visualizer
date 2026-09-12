import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import ELK from "elkjs/lib/elk.bundled.js";
import type { Graph } from "../src/shared/graph";
async function main() {
  const results = [];
  for (const scenario of [
    { name: "small", files: 10, functions: 9 },
    { name: "medium", files: 500, functions: 9 },
    { name: "large", files: 2000, functions: 9 },
    { name: "dense", files: 50, functions: 20 },
    { name: "single-large-file", files: 1, functions: 19999 },
  ]) {
    const count = scenario.files;
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "visualizer-benchmark-"),
    );
    try {
      for (let i = 0; i < count; i++)
        fs.writeFileSync(
          path.join(root, `file${i}.ts`),
          Array.from(
            { length: scenario.functions },
            (_, j) =>
              `export function f${j}(n: number) { ${scenario.name === "dense" ? Array.from({ length: 10 }, (_, k) => `f${(j + k + 1) % scenario.functions}(n);`).join(" ") : ""} ${j ? `f${j - 1}(n);` : ""} if(n>0) f${(j + 1) % scenario.functions}(n-1); }`,
          ).join("\n"),
        );
      const graph = await new Promise<Graph>((resolve, reject) => {
        const worker = new Worker(path.resolve("dist/analysis.cjs"), {
          workerData: { root },
        });
        worker.on("message", (m) => {
          if (m.type === "complete") resolve(m.graph);
          if (m.type === "failed") reject(new Error(m.error));
        });
        worker.on("error", reject);
      });
      const layoutStart = performance.now();
      await new ELK().layout({
        id: "root",
        layoutOptions: { "elk.algorithm": "layered", "elk.direction": "DOWN" },
        children: graph.files.map((f) => ({
          id: f.id,
          width: 355,
          height: 80,
        })),
      });
      results.push({
        scenario: scenario.name,
        files: count,
        declarations: graph.declarations.length,
        connections: graph.connections.length,
        analysisMs: Math.round(graph.metrics.analysisMs),
        layoutMs: Math.round(performance.now() - layoutStart),
        peakMemoryMiB: Math.round(graph.metrics.peakMemoryBytes / 1048576),
        transferMiB: Number(
          (Buffer.byteLength(JSON.stringify(graph)) / 1048576).toFixed(2),
        ),
      });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  console.log(
    JSON.stringify(
      {
        machine: `${os.platform()} ${os.arch()} ${os.cpus()[0].model}`,
        node: process.version,
        results,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
