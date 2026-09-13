import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const analyzer = new URL("../dist/run-analysis.js", import.meta.url).href;
const hierarchy = new URL("../dist/hierarchy.js", import.meta.url).href;
const display = new URL("../dist/display.js", import.meta.url).href;
for (const count of [10, 500, 2000]) {
  const root = mkdtempSync(join(tmpdir(), "cvis-benchmark-"));
  try {
    for (let file = 0; file < count; file++) {
      const functions = Array.from(
        { length: 10 },
        (_, i) => `export function fn${i}() { next(); fn${(i + 1) % 10}(); }`,
      ).join("\n");
      writeFileSync(
        join(root, `file${file}.ts`),
        `import { fn0 as next } from './file${(file + 1) % count}';\n${functions}\n`,
      );
    }
    const start = performance.now();
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { runAnalysis } from ${JSON.stringify(analyzer)};
      import { sourceRows } from ${JSON.stringify(display)};
      import { fileHierarchy } from ${JSON.stringify(hierarchy)};
      const start = performance.now();
      const snapshot = await runAnalysis(process.argv[1]);
      const analyzed = performance.now();
      const target = snapshot.declarations.values().next().value;
      const rows = fileHierarchy(snapshot, target.file, target.id);
      const displayed = performance.now();
      const id = snapshot.declarations.keys().next().value;
      for (let i = 0; i < 1000; i++) sourceRows(snapshot, id);
      console.log(JSON.stringify({files: snapshot.files.length, declarations: snapshot.declarations.size, connections: snapshot.connections.length, rows: rows.length, analysisMs: Math.round(analyzed - start), hierarchyMs: Math.round(displayed - analyzed), sourceOpenAverageMs: (performance.now() - displayed) / 1000, peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024)}));
    `,
        root,
      ],
      { encoding: "utf8" },
    );
    if (child.status !== 0)
      throw new Error(child.stderr || `Benchmark exited ${child.status}`);
    console.log(
      JSON.stringify({
        ...JSON.parse(child.stdout),
        totalProcessMs: Math.round(performance.now() - start),
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
