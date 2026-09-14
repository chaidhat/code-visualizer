import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const fixture = fileURLToPath(
  new URL("../examples/branching", import.meta.url),
);
const run = (...args) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
const result = (...args) => {
  const output = run(...args);
  assert.equal(output.stderr, "");
  assert.doesNotMatch(output.stdout, /\x1b/);
  return { ...output, data: JSON.parse(output.stdout) };
};
const automatic = result(fixture, "submit");
assert.equal(automatic.status, 0);
assert.equal(automatic.data.status, "ok");
assert.ok(
  automatic.data.hierarchy[0].child[0].child[0].child.some(
    (item) => item.name === "saveDraft" && item.line === 1,
  ),
);
const explicit = result(fixture, "submit", "--json");
assert.deepEqual(explicit.data, automatic.data);
assert.match(run("--help").stdout, /--json/);
assert.doesNotMatch(run("--help").stdout, /--plain/);
assert.equal(run("--version").stdout.trim(), "0.1.0");
for (const args of [
  [],
  [fixture],
  [fixture, ""],
  [fixture, "   "],
  ["--unknown"],
  [fixture, "submit", "--plain"],
  [fixture, "submit", "--plaintext"],
  ["/does-not-exist-cvis", "hello"],
]) {
  const rejected = result(...args);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.data.status, "error");
}
const root = mkdtempSync(join(tmpdir(), "cvis smoke "));
try {
  writeFileSync(join(root, "main.ts"), "export function hello() {}");
  const named = result(root, "hello", "--json");
  assert.equal(named.status, 0);
  assert.equal(
    named.data.hierarchy[0].path,
    realpathSync(join(root, "main.ts")),
  );
  for (const name of ["missing", "Hello"]) {
    const missing = result(root, name);
    assert.equal(missing.status, 0);
    assert.equal(missing.data.status, "not_found");
    assert.deepEqual(missing.data.matches, []);
  }
  writeFileSync(
    join(root, "object.ts"),
    "export const settings = { enabled: true };",
  );
  assert.equal(
    result(root, "settings", "--json").data.hierarchy[0].kind,
    "object",
  );
  writeFileSync(join(root, "duplicate.ts"), "export function hello() {}");
  const duplicate = result(root, "hello");
  assert.equal(duplicate.data.status, "ambiguous");
  assert.deepEqual(duplicate.data.matches.map((item) => item.file).sort(), [
    "duplicate.ts",
    "main.ts",
  ]);
  assert.equal(result(root, "hello", "extra").status, 1);
  writeFileSync(join(root, "tsconfig.json"), "{broken");
  const failure = result(root, "hello");
  assert.equal(failure.status, 1);
  assert.equal(failure.data.status, "error");
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(
  "Packaged command checks passed: worker startup, JSON output, help, version, paths with spaces, argument errors, and worker failures.",
);
