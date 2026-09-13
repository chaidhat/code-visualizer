import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileHierarchy } from "../src/hierarchy.js";
import { analyze } from "../src/analyze.js";
import { safeText, sourceRows, sourceSegments } from "../src/display.js";

function fixture(files: Record<string, string>, run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "cvis-test-"));
  try {
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("resolves aliases, re-exports, both branches, nested ownership and object/type references", () => {
  fixture(
    {
      "actions.ts":
        "export function save() { return 1 }\nexport function publish() {}\nexport interface Options { ready: boolean }\nexport class Store { run() { save() } }\nexport const settings = { ready: true };",
      "barrel.ts": 'export { save as persist } from "./actions";',
      "main.ts":
        'import { persist as draft } from "./barrel";\nimport { publish, Options, Store, settings } from "./actions";\nexport function submit(o: Options) { if(o.ready) draft(); else publish(); const store = new Store(); store.run(); if(settings.ready) publish(); [1].map(() => draft()); }',
    },
    (root) => {
      const snapshot = analyze(root);
      const declarations = [...snapshot.declarations.values()];
      const submit = declarations.find((d) => d.name === "submit")!;
      const save = declarations.find((d) => d.name === "save")!;
      const edges = snapshot.connections.filter((e) => e.from === submit.id);
      assert.ok(edges.some((e) => e.to === save.id));
      assert.ok(
        edges.some((e) => snapshot.declarations.get(e.to!)?.name === "publish"),
      );
      assert.ok(
        edges.some((e) => snapshot.declarations.get(e.to!)?.name === "run"),
      );
      assert.ok(
        edges.some((e) => snapshot.declarations.get(e.to!)?.name === "Store"),
      );
      assert.ok(
        edges.some(
          (e) =>
            snapshot.declarations.get(e.to!)?.name === "Options" &&
            e.kind === "reference",
        ),
      );
      assert.ok(
        edges.some(
          (e) =>
            snapshot.declarations.get(e.to!)?.name === "settings" &&
            e.kind === "reference",
        ),
      );
      assert.equal(edges.filter((e) => e.to === save.id).length, 1);
      assert.ok(!declarations.some((d) => d.name.startsWith("callback")));
      assert.match(
        fileHierarchy(snapshot, "main.ts")
          .map((r) => r.text)
          .join("\n"),
        /submit\(\)\s+main.ts:3/,
      );
    },
  );
});

test("does not guess dynamic, missing or reassigned targets and preserves recursion", () => {
  fixture(
    {
      "main.ts":
        "function a() { a() }\nfunction b() {}\nlet action = () => a();\naction = () => b();\nfunction run(key: string, object: any) { action(); object[key](); missing(); const choice = key ? a : b; choice(); }",
    },
    (root) => {
      const snapshot = analyze(root);
      const run = [...snapshot.declarations.values()].find(
        (d) => d.name === "run",
      )!;
      const edges = snapshot.connections.filter((e) => e.from === run.id);
      assert.equal(edges.length, 4);
      assert.ok(edges.every((e) => e.status === "unresolved"));
      const a = [...snapshot.declarations.values()].find(
        (d) => d.name === "a",
      )!;
      assert.ok(
        snapshot.connections.some((e) => e.from === a.id && e.to === a.id),
      );
    },
  );
});

test("honors separate project settings and chooses overload implementation", () => {
  fixture(
    {
      "one/tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@lib":["lib.ts"]}}}',
      "one/lib.ts":
        "export function save(a: number): number;\nexport function save(a: number) { return a }",
      "one/main.ts":
        'import { save } from "@lib"; export const run = () => save(1);',
      "two/tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@lib":["different.ts"]}}}',
      "two/different.ts": "export function save() {}",
      "two/main.ts":
        'import { save } from "@lib"; export const run = () => save();',
    },
    (root) => {
      const snapshot = analyze(root);
      const calls = snapshot.connections.filter((e) => e.label === "save");
      assert.equal(calls.length, 2);
      const targets = calls.map((e) => snapshot.declarations.get(e.to!)!);
      assert.deepEqual(targets.map((t) => t.file).sort(), [
        "one/lib.ts",
        "two/different.ts",
      ]);
      assert.match(
        sourceRows(snapshot, targets.find((t) => t.file === "one/lib.ts")!.id)
          .map((r) => r.text)
          .join("\n"),
        /return a/,
      );
    },
  );
});

test("file selection stays scoped and source shows the complete declaration", () => {
  fixture(
    {
      "main.ts":
        'import { other } from "./other";\nexport const run = () => {\n  other();\n  return { value: 1 };\n};\nconst after = 4;',
      "other.ts": "export function other() {}",
    },
    (root) => {
      const snapshot = analyze(join(root, "main.ts"));
      assert.deepEqual(snapshot.files, ["main.ts"]);
      assert.equal(snapshot.connections[0].status, "external");
      const run = [...snapshot.declarations.values()].find(
        (d) => d.name === "run",
      )!;
      const code = sourceRows(snapshot, run.id)
        .map((r) => r.text)
        .join("\n");
      assert.match(code, /return \{ value: 1 \}/);
      assert.doesNotMatch(code, /after|changed/);
    },
  );
});

test("discovery excludes outputs, declaration files and symlink cycles", () => {
  fixture(
    {
      "main.ts": "function ok() {}",
      "view.tsx": "export const View = () => <div />;",
      "module.mts": "export function esm() {}",
      "common.cts": "function cjs() {}",
      "types.d.ts": "declare function ignored(): void;",
      "node_modules/pkg/index.ts": "function ignored() {}",
      "dist/output.ts": "function ignored() {}",
    },
    (root) => {
      symlinkSync(root, join(root, "cycle"));
      const snapshot = analyze(root);
      assert.equal(snapshot.files.length, 4);
      assert.ok(snapshot.warnings.some((w) => w.includes("symbolic")));
    },
  );
});

test("malformed settings fail visibly and syntax errors remain visible", () => {
  fixture(
    { "tsconfig.json": "{broken", "main.ts": "function a() {}" },
    (root) => assert.throws(() => analyze(root)),
  );
  fixture({ "main.ts": "function broken( {" }, (root) =>
    assert.ok(analyze(root).warnings.length > 0),
  );
});

test("empty folders are readable and terminal controls are escaped", () => {
  fixture({}, (root) => assert.equal(analyze(root).files.length, 0));
  assert.equal(safeText("\x1b[2Jbad\u202e"), "\\u001b[2Jbad\\u202e");
});

test("class expressions and arrow functions open complete variable declarations", () => {
  fixture(
    {
      "main.ts":
        "export const Service = class { run() {} };\nexport const create = () => new Service();\ncreate();",
    },
    (root) => {
      const snapshot = analyze(root);
      const create = [...snapshot.declarations.values()].find(
        (d) => d.name === "create",
      )!;
      const service = [...snapshot.declarations.values()].find(
        (d) => d.name === "Service",
      )!;
      assert.match(
        sourceRows(snapshot, create.id)
          .map((r) => r.text)
          .join("\n"),
        /export const create =/,
      );
      assert.match(
        sourceRows(snapshot, service.id)
          .map((r) => r.text)
          .join("\n"),
        /export const Service = class/,
      );
      assert.ok(
        snapshot.connections.some(
          (e) => e.from === create.id && e.to === service.id,
        ),
      );
    },
  );
});

test("unresolved imports report settings problems instead of silently losing calls", () => {
  fixture(
    {
      "tsconfig.json":
        '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}',
      "package.json": '{"type":"module"}',
      "main.ts": 'import { call } from "./missing"; call();',
    },
    (root) => {
      const snapshot = analyze(root);
      assert.ok(
        snapshot.warnings.some((w) => w.includes("Could not resolve import")),
      );
      assert.equal(snapshot.connections[0].status, "unresolved");
    },
  );
});

test("read progress counts selected source files once and excludes dependencies", () => {
  fixture(
    {
      "main.ts":
        'import { other } from "./other"; export function run() { other(); }',
      "other.ts": "export function other() {}",
      "tsconfig.json": "{}",
    },
    (root) => {
      const progress: { read: number; total: number }[] = [];
      analyze(root, (update) => progress.push(update));
      assert.deepEqual(progress, [
        { read: 0, total: 2 },
        { read: 1, total: 2 },
        { read: 2, total: 2 },
      ]);
      const single: { read: number; total: number }[] = [];
      analyze(join(root, "main.ts"), (update) => single.push(update));
      assert.deepEqual(single, [
        { read: 0, total: 1 },
        { read: 1, total: 1 },
      ]);
    },
  );
});

test("excludes __tests__ and test folders and their callers, including direct selections", () => {
  fixture(
    {
      "main.ts":
        'import { helper } from "./nested/__tests__/helper"; export function run() { helper(); }',
      "nested/__tests__/helper.ts": "export function helper() {}",
      "nested/__tests__/deeper/caller.ts":
        'import { run } from "../../../main"; export function testCaller() { run(); }',
      "__tests__/caller.ts":
        'import { run } from "../main"; export function rootTest() { run(); }',
      "test/caller.ts":
        'import { run } from "../main"; export function excludedTest() { run(); }',
      "nested/test/deeper/caller.ts":
        'import { run } from "../../../main"; export function nestedTest() { run(); }',
      "tests/kept.ts": "export function kept() {}",
    },
    (root) => {
      const snapshot = analyze(root);
      assert.deepEqual(snapshot.files, ["main.ts", "tests/kept.ts"]);
      assert.ok(
        [...snapshot.declarations.values()].every(
          (item) => !item.file.includes("__tests__"),
        ),
      );
      assert.doesNotMatch(
        fileHierarchy(snapshot, "main.ts")
          .map((row) => row.text)
          .join("\n"),
        /helper|testCaller|rootTest|excludedTest|nestedTest|__tests__/,
      );
      for (const path of [
        "nested/__tests__",
        "nested/__tests__/deeper",
        "nested/__tests__/helper.ts",
        "test",
        "test/caller.ts",
        "nested/test/deeper",
      ]) {
        const selected = analyze(join(root, path));
        assert.equal(selected.files.length, 0);
        assert.match(selected.warnings.join(" "), /__tests__.*excluded/);
      }
    },
  );
});

test("source highlights resolved function and object mentions, excluding strings, comments and shadowed values", () => {
  fixture(
    {
      "main.ts": [
        "function callee() {}",
        "const object = { value: 1 };",
        "function caller() {",
        "\tcallee(); callee();",
        "  const text = 'callee object'; // callee object",
        "  return object.value;",
        "}",
        "function shadow(callee: string) { return callee; }",
      ].join("\r\n"),
    },
    (root) => {
      const snapshot = analyze(root);
      const caller = [...snapshot.declarations.values()].find(
        (item) => item.name === "caller",
      )!;
      const rows = sourceRows(snapshot, caller.id);
      const highlighted = rows.flatMap((row) =>
        (row.highlights ?? []).map((span) =>
          row.text.slice(span.start, span.end),
        ),
      );
      assert.deepEqual(highlighted, ["callee", "callee"]);
      const hiddenRows = sourceRows(snapshot, caller.id, new Set([caller.id]));
      assert.ok(
        hiddenRows.every(
          (row) => !row.highlights?.length && !row.children?.length,
        ),
      );
      const visibleTargets = new Set(
        fileHierarchy(snapshot, caller.file, caller.id).flatMap((row) =>
          row.target ? [row.target] : [],
        ),
      );
      assert.deepEqual(
        sourceRows(snapshot, caller.id, visibleTargets).flatMap((row) =>
          (row.highlights ?? []).map((span) =>
            row.text.slice(span.start, span.end),
          ),
        ),
        ["callee", "callee"],
      );
      assert.deepEqual(
        rows.flatMap((row) =>
          (row.children ?? []).map((span) =>
            row.text.slice(span.start, span.end),
          ),
        ),
        ["callee", "callee"],
      );
      assert.equal(
        sourceSegments(
          rows.find((row) => row.children?.length)!,
          0,
        )
          .filter((segment) => segment.child)
          .map((segment) => segment.text)
          .join(" "),
        "callee callee",
      );
      const callRow = rows.find((row) => row.highlights?.length === 2)!;
      const offset = callRow.highlights![0]!.start + 2;
      const segments = sourceSegments(callRow, offset);
      assert.equal(segments[0]!.text, "llee");
      assert.equal(segments[0]!.highlighted, true);
      assert.equal(
        segments.map((segment) => segment.text).join(""),
        callRow.text.slice(offset),
      );
      const shadow = [...snapshot.declarations.values()].find(
        (item) => item.name === "shadow",
      )!;
      assert.ok(
        sourceRows(snapshot, shadow.id).every((row) => !row.highlights?.length),
      );
    },
  );
});

test("nested promise callbacks and local helpers belong to the surrounding function without false loops", () => {
  fixture(
    {
      "main.ts": `
function callee() {}
async function outer() {
  await new Promise<void>((resolve) => {
    let finalizing = false;
    const finalize = async (status: 200 | 404 | 500): Promise<void> => {
      callee(); resolve();
    };
    finalize(200);
  });
}
`,
    },
    (root) => {
      const snapshot = analyze(root);
      const declarations = [...snapshot.declarations.values()];
      const outer = declarations.find((item) => item.name === "outer")!;
      const callee = declarations.find((item) => item.name === "callee")!;
      assert.ok(
        !declarations.some(
          (item) =>
            item.name === "finalize" || item.name.startsWith("callback"),
        ),
      );
      assert.ok(
        snapshot.connections.some(
          (edge) => edge.from === outer.id && edge.to === callee.id,
        ),
      );
      assert.ok(
        !snapshot.connections.some(
          (edge) => edge.from === outer.id && edge.to === outer.id,
        ),
      );
      assert.match(
        sourceRows(snapshot, outer.id)
          .map((row) => row.text)
          .join("\n"),
        /const finalize/,
      );
    },
  );
});

test("source is loaded on demand and missing files produce a visible error", () => {
  fixture({ "main.ts": "export function saved() { return 42 }" }, (root) => {
    const snapshot = analyze(root);
    assert.equal("sources" in snapshot, false);
    assert.equal("sourceDirectory" in snapshot, false);
    const id = [...snapshot.declarations.values()].find(
      (d) => d.name === "saved",
    )!.id;
    // Equal-length edits prove a fresh read without changing recorded positions.
    writeFileSync(
      join(root, "main.ts"),
      "export function saved() { return 99 }",
    );
    assert.match(
      sourceRows(snapshot, id)
        .map((r) => r.text)
        .join("\n"),
      /return 99/,
    );
    rmSync(join(root, "main.ts"));
    assert.match(
      sourceRows(snapshot, id)[0].text,
      /Could not read source file: main.ts/,
    );
    writeFileSync(
      join(root, "main.ts"),
      "export function saved() { return 42 }",
    );
    assert.match(sourceRows(snapshot, id)[0].text, /return 42/);
  });
});
