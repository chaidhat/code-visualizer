import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await build({
  entryPoints: ["src/server/analysis/worker.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["typescript"],
  outfile: "dist/analysis.cjs",
});
await mkdir("public/vendor", { recursive: true });
await copyFile(
  "node_modules/elkjs/lib/elk-worker.min.js",
  "public/vendor/elk-worker.min.js",
);
