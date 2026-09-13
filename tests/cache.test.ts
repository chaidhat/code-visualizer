import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { deserialize } from "node:v8";
import { analyze } from "../src/analyze.js";
import { cachedAnalysis } from "../src/analysis-cache.js";
import { sourceRows } from "../src/display.js";

function fixture(
  run: (
    root: string,
    cache: string,
    write: (file: string, text: string) => void,
  ) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), "cvis-cache-test-"));
  const root = join(directory, "project");
  mkdirSync(root);
  const write = (file: string, text: string) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  write("tsconfig.json", '{"compilerOptions":{"types":[],"noLib":true}}');
  write(
    "main.ts",
    'import { save } from "./helper"; export function run() { save(); }',
  );
  write("helper.ts", "export function save() {}");
  try {
    run(root, join(directory, "cache"), write);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function start(root: string, cache: string) {
  const progress: number[] = [];
  const snapshot = cachedAnalysis(
    root,
    (value) => progress.push(value.read),
    cache,
  );
  return { snapshot, reused: !progress.includes(0) };
}

test("reuses analysis without compiler work, saves no source copies, and opens original source", () => {
  fixture((root, cache) => {
    const first = start(root, cache);
    assert.equal(first.reused, false);
    const second = start(root, cache);
    assert.equal(second.reused, true);
    assert.deepEqual(
      { ...second.snapshot, analysis: undefined },
      { ...first.snapshot, analysis: undefined },
    );
    const files = readdirSync(cache);
    assert.equal(files.length, 1);
    const path = join(cache, files[0]);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const saved = deserialize(readFileSync(path).subarray(64));
    assert.equal("sources" in saved.snapshot, false);
    assert.equal("sourceDirectory" in saved.snapshot, false);
    const run = [...second.snapshot.declarations.values()].find(
      (d) => d.name === "run",
    )!;
    assert.match(sourceRows(second.snapshot, run.id)[0].text, /save\(\)/);
  });
});

test("checks content even when size and timestamp are unchanged, and detects additions and deletions", () => {
  fixture((root, cache, write) => {
    start(root, cache);
    const path = join(root, "helper.ts");
    const original = statSync(path);
    write("helper.ts", "export function send() {}");
    utimesSync(path, original.atime, original.mtime);
    assert.equal(start(root, cache).reused, false);
    assert.equal(start(root, cache).reused, true);
    write("added.ts", "export function added() {}");
    assert.equal(start(root, cache).reused, false);
    rmSync(join(root, "added.ts"));
    assert.equal(start(root, cache).reused, false);
  });
});

test("invalidates settings, external dependency contents, and previously missing imports", () => {
  fixture((root, cache, write) => {
    write(
      "main.ts",
      'import { thing } from "pkg"; import { missing } from "./missing"; export function run() { thing(); missing(); }',
    );
    write("node_modules/pkg/package.json", '{"types":"index.d.ts"}');
    write(
      "node_modules/pkg/index.d.ts",
      "export declare function thing(): void;",
    );
    start(root, cache);
    assert.equal(start(root, cache).reused, true);
    write(
      "node_modules/pkg/index.d.ts",
      "export declare function thing(): string;",
    );
    assert.equal(start(root, cache).reused, false);
    write("missing.ts", "export function missing() {}");
    assert.equal(start(join(root, "main.ts"), cache).reused, false);
    assert.equal(start(join(root, "main.ts"), cache).reused, true);
    // The selected file set stays identical, but a formerly missing resolution becomes possible.
    rmSync(join(root, "missing.ts"));
    assert.equal(start(join(root, "main.ts"), cache).reused, false);
    write("missing.ts", "export function missing() {}");
    assert.equal(start(join(root, "main.ts"), cache).reused, false);
    write(
      "tsconfig.json",
      '{"compilerOptions":{"types":[],"noLib":true,"strict":true}}',
    );
    assert.equal(start(root, cache).reused, false);
  });
});

test("damaged or unwritable saved data falls back with a visible warning", () => {
  fixture((root, cache) => {
    start(root, cache);
    writeFileSync(join(cache, readdirSync(cache)[0]), "broken");
    const recovered = start(root, cache);
    assert.equal(recovered.reused, false);
    assert.ok(
      recovered.snapshot.warnings.some((w) =>
        w.includes("Could not reuse saved analysis"),
      ),
    );
    assert.equal(start(root, cache).reused, true);
    const blocked = join(root, "blocked");
    writeFileSync(blocked, "not a directory");
    const result = start(root, blocked);
    assert.ok(
      result.snapshot.warnings.some((w) =>
        w.includes("Could not save analysis"),
      ),
    );
  });
});

test("selectively rebuilds a changed module and transitive callers while reusing unrelated files", () => {
  fixture((root, cache, write) => {
    write("barrel.ts", 'export { save } from "./helper";');
    write(
      "main.ts",
      'import { save } from "./barrel"; export function run() { save(); }',
    );
    write("unrelated.ts", "export function unrelated() { console.log(42); }");
    start(root, cache);
    write(
      "helper.ts",
      "// moved declaration\nexport function save() { return 2; }",
    );
    const changed = start(root, cache).snapshot;
    assert.deepEqual(changed.analysis, { analyzedFiles: 3, reusedFiles: 1 });
    const fresh = analyze(root);
    assert.deepEqual(changed.declarations, fresh.declarations);
    assert.deepEqual(changed.connections, fresh.connections);
    assert.deepEqual(changed.references, fresh.references);
    assert.deepEqual(changed.warnings, fresh.warnings);
    assert.equal(start(root, cache).reused, true);
  });
});

test("clears stale file warnings and rebuilds all files when a module introduces globals", () => {
  fixture((root, cache, write) => {
    write("helper.ts", "export function save() { const x = ; }");
    write("unrelated.ts", "export function unrelated() { console.log(42); }");
    const first = start(root, cache).snapshot;
    assert.ok(first.warnings.some((w) => w.includes("helper.ts")));
    write("helper.ts", "export function save() {}");
    const fixed = start(root, cache).snapshot;
    assert.equal(fixed.analysis?.reusedFiles, 1);
    assert.deepEqual(fixed.warnings, analyze(root).warnings);
    write(
      "helper.ts",
      "export function save() {} declare global { interface Shared { value: number } }",
    );
    const global = start(root, cache).snapshot;
    assert.equal(global.analysis?.reusedFiles, 0);
  });
});

test("does not save analysis when files change during the run", () => {
  fixture((root, cache, write) => {
    let changed = false;
    const result = cachedAnalysis(
      root,
      (progress) => {
        if (progress.read > 0 && !changed) {
          changed = true;
          write("helper.ts", "export function save() { return 999; }");
        }
      },
      cache,
    );
    assert.ok(
      result.warnings.some((w) => w.includes("changed during analysis")),
    );
  });
});

test("selective reanalysis follows cycles and skips unaffected project groups", () => {
  fixture((root, cache, write) => {
    write(
      "helper.ts",
      'import { run } from "./main"; export function save() { run(); }',
    );
    write(
      "separate/tsconfig.json",
      '{"compilerOptions":{"noLib":true,"types":[]}}',
    );
    write("separate/other.ts", "export function other() { return 1; }");
    start(root, cache);
    write(
      "helper.ts",
      'import { run } from "./main"; export function save() { run(); return 2; }',
    );
    const changed = start(root, cache).snapshot;
    assert.deepEqual(changed.analysis, { analyzedFiles: 2, reusedFiles: 1 });
    const fresh = analyze(root);
    assert.deepEqual(changed.declarations, fresh.declarations);
    assert.deepEqual(changed.connections, fresh.connections);
  });
});

test("import changes that can alter shared global types force a full rebuild", () => {
  fixture((root, cache, write) => {
    write("unrelated.ts", "export function unrelated() {}");
    write("node_modules/globals/package.json", '{"types":"index.d.ts"}');
    write(
      "node_modules/globals/index.d.ts",
      "export {}; declare global { interface Added { value: string } }",
    );
    start(root, cache);
    write("helper.ts", 'import "globals"; export function save() {}');
    const added = start(root, cache).snapshot;
    assert.equal(added.analysis?.reusedFiles, 0);
    assert.equal(start(root, cache).reused, true);
    write("helper.ts", "export function save() {}");
    const removed = start(root, cache).snapshot;
    assert.equal(removed.analysis?.reusedFiles, 0);
    assert.deepEqual(removed.connections, analyze(root).connections);
  });
});
