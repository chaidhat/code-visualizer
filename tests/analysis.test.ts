import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze } from "../src/server/analysis/graph";
function fixture(files: Record<string, string>, run: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "visualizer-test-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), text);
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test("direct, aliases, reexports, branches, recursion, callbacks and exact evidence", () =>
  fixture(
    {
      "lib.ts": "export function left() {}\nexport function right() {}",
      "barrel.ts": "export { left as save } from './lib';",
      "main.ts": `import {save as first} from './barrel';
import {right} from './lib';
export function run(flag: boolean) {
 if (flag) first(); else right();
 const choice = flag ? first : right;
 choice();
 [1].forEach(() => first());
 run(false);
}
`,
    },
    (root) => {
      const graph = analyze(root);
      const names = new Map(graph.declarations.map((d) => [d.id, d.name]));
      const calls = graph.connections.filter((e) => e.relation === "call");
      assert(
        calls.some(
          (e) =>
            names.get(e.source) === "run" &&
            names.get(e.target) === "left" &&
            e.evidence[0].line === 4,
        ),
      );
      assert(
        calls.some(
          (e) =>
            names.get(e.target) === "right" && e.evidence[0].conditions.length,
        ),
      );
      assert.equal(calls.filter((e) => e.resolution === "possible").length, 2);
      assert(graph.connections.some((e) => e.relation === "callback"));
      assert(
        calls.some(
          (e) =>
            names.get(e.source)?.startsWith("callback") &&
            names.get(e.target) === "left",
        ),
      );
      assert(calls.some((e) => e.source === e.target));
      assert.equal(
        calls.reduce((n, e) => n + e.evidence.length, 0),
        7,
      );
    },
  ));
test("objects, initialization, class methods, overloads, duplicate scopes and dynamic calls", () =>
  fixture(
    {
      "main.ts": `
function make() {return 1}
const object = {value:make(), method(){make()}, nested:{go:()=>make()}};
class Thing { constructor(){make()} method(x:string):void; method(x:number):void; method(x:unknown){make()} }
function one(){function duplicate(){make()} duplicate()}
function two(){function duplicate(){make()} duplicate()}
const instance=new Thing(); instance.method(1); object.method(); object.nested.go();
let assigned=make; assigned=()=>2; assigned();
const key='method'; object[key]();
`,
    },
    (root) => {
      const g = analyze(root);
      const named = (id: string) => g.declarations.find((d) => d.id === id)!;
      assert.equal(
        g.declarations.filter((d) => d.name === "duplicate").length,
        2,
      );
      assert(
        g.connections.some(
          (e) =>
            named(e.source).name === "Object initialization" &&
            named(e.target).name === "make",
        ),
      );
      assert(
        g.connections.some(
          (e) =>
            named(e.source).name === "method" &&
            named(e.target).name === "make",
        ),
      );
      assert(g.connections.some((e) => e.reason?.includes("reassigned")));
      assert(g.connections.some((e) => e.reason?.includes("Runtime property")));
      assert(
        g.connections.some(
          (e) =>
            named(e.target).name === "method" && e.resolution === "resolved",
        ),
      );
      assert(g.declarations.some((d) => d.name === "nested" && d.owner));
    },
  ));
test("missing imports, optional calls, JavaScript fallback and unsupported files remain visible", () =>
  fixture(
    {
      "main.js": `import {missing} from './gone'; missing?.(); const dynamic = globalThis.unknown; dynamic();`,
      "notes.md": "hello",
    },
    (root) => {
      const g = analyze(root);
      assert.equal(g.connections.length, 2);
      assert(g.connections.every((e) => e.resolution === "unresolved"));
      assert(
        g.connections.some((e) =>
          e.evidence[0].conditions.includes("Optional call"),
        ),
      );
      assert(g.files.some((f) => f.path === "notes.md" && !f.supported));
      assert(g.diagnostics.some((d) => d.includes("fallback")));
      assert(g.diagnostics.some((d) => d.includes("gone")));
    },
  ));
test("project references and malformed settings retain files", () =>
  fixture(
    {
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./a" }, { path: "./b" }],
      }),
      "a/tsconfig.json": JSON.stringify({
        compilerOptions: { composite: true },
        include: ["*.ts"],
      }),
      "a/a.ts": "export function duplicate(){}",
      "b/tsconfig.json": "{broken",
      "b/b.ts": "export function duplicate(){} duplicate();",
    },
    (root) => {
      const g = analyze(root);
      assert.equal(
        g.declarations.filter((d) => d.name === "duplicate").length,
        2,
      );
      assert(g.diagnostics.some((d) => d.includes("Could not parse")));
      assert(g.connections.some((e) => e.resolution === "resolved"));
    },
  ));

test("all condition forms, JSX callbacks and declared interface targets retain evidence", () =>
  fixture(
    {
      "main.tsx": `
declare const flag: boolean;
function a(){return 1} function b(){return 2}
function branch(){
 switch(flag){case true:a();break;default:b()}
 flag ? a() : b(); flag && a(); flag || b();
 for(let i=0;i<2;i++) a();
 try {a()} catch {b()} finally {a()}
}
interface Runner { run():void }
function invoke(r:Runner){r.run()}
const View=()=> <button onClick={()=>a()}>Run</button>;
`,
    },
    (root) => {
      const g = analyze(root);
      const edges = g.connections.filter((e) =>
        e.evidence.some((v) => v.file === "main.tsx"),
      );
      const spans = new Set(
        edges.flatMap((e) => e.evidence.map((v) => v.start)),
      );
      assert.equal(spans.size, 12);
      assert(
        edges.some(
          (e) =>
            e.resolution === "unresolved" && e.reason?.includes("Interface"),
        ),
      );
      assert(g.declarations.some((d) => d.name.startsWith("callback")));
    },
  ));
