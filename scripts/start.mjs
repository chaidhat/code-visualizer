import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const mode = process.argv[2];
if (mode === "dev") {
  const build = spawnSync("npm", ["run", "worker:build"], { stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", mode, "--hostname", "127.0.0.1"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      VISUALIZER_TOKEN: randomBytes(32).toString("hex"),
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
