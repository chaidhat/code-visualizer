import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const plain = run(fixture, "submit");
assert.equal(plain.status, 0, plain.stderr);
assert.match(plain.stdout, /saveDraft\(\)\s+actions.ts:1/);
assert.match(plain.stdout, /submit\(\)/);
assert.doesNotMatch(plain.stdout, /\x1b/);
assert.match(run("--help").stdout, /Usage: cvis/);
assert.equal(run("--version").stdout.trim(), "0.1.0");
assert.equal(run().status, 1);
assert.equal(run("--unknown").status, 1);
assert.equal(run("/does-not-exist-cvis", "hello").status, 1);
for (const args of [
  [fixture],
  [fixture, "--plain"],
  [fixture, ""],
  [fixture, "   "],
]) {
  const rejected = run(...args);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /required function or object name/);
  assert.equal(rejected.stdout, "");
}
const root = mkdtempSync(join(tmpdir(), "cvis smoke "));
try {
  writeFileSync(join(root, "main.ts"), "export function hello() {}");
  assert.equal(run(root, "hello", "--plain").status, 0);
  const named = run(root, "hello");
  assert.equal(named.status, 0, named.stderr);
  assert.match(named.stdout, /hello\(\)\s+main.ts:1/);
  const missing = run(root, "missing");
  assert.equal(missing.status, 0);
  assert.equal(missing.stderr, "");
  assert.equal(
    missing.stdout.trim(),
    'No function or object named "missing" found.',
  );
  assert.match(run(root, "Hello").stdout, /No function or object/);
  writeFileSync(
    join(root, "object.ts"),
    "export const settings = { enabled: true };",
  );
  assert.match(
    run(root, "settings", "--plain").stdout,
    /settings\s+object.ts:1/,
  );
  writeFileSync(join(root, "duplicate.ts"), "export function hello() {}");
  const duplicate = run(root, "hello");
  assert.equal(duplicate.status, 0);
  assert.match(duplicate.stdout, /Multiple declarations/);
  assert.match(duplicate.stdout, /duplicate.ts:1/);
  assert.match(duplicate.stdout, /main.ts:1/);
  assert.equal(run(root, "hello", "extra").status, 1);
  writeFileSync(join(root, "tsconfig.json"), "{broken");
  const failure = run(root, "hello");
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /cvis:/);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(
  "Packaged command checks passed: worker startup, plain output, help, version, paths with spaces, argument errors, and worker failures.",
);
