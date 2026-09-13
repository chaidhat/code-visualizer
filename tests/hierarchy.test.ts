import assert from "node:assert/strict";
import { test } from "node:test";
import { fileHierarchy } from "../src/hierarchy.js";
import type { Snapshot } from "../src/model.js";

function graph(edges: [string, string][], selected = "focus"): Snapshot {
  const ids = new Set([selected, ...edges.flat()]);
  return {
    root: "/example",
    files: ["selected.ts", "other.ts"],
    warnings: [],
    declarations: new Map(
      [...ids].map((id, index) => [
        id,
        {
          id,
          name: id,
          file: id === selected ? "selected.ts" : "other.ts",
          kind: "function",
          start: index,
          end: index + 1,
          line: index + 1,
        },
      ]),
    ),
    connections: edges.map(([from, to]) => ({
      from,
      to,
      label: to,
      kind: "call",
      status: "resolved",
      line: 1,
    })),
  };
}

test("hierarchy shows callers, loops, repeated branches, and selected-declaration emphasis", () => {
  const data = graph([
    ["caller", "func2"],
    ["func2", "func3"],
    ["func2", "caller"],
    ["caller", "func1"],
    ["func1", "func2"],
    ["func1", "focus"],
    ["focus", "callee1"],
    ["callee1", "func2"],
    ["focus", "callee2"],
  ]);
  data.declarations.get("callee1")!.file = "selected.ts";
  const rows = fileHierarchy(data, "selected.ts", "focus");
  assert.equal(rows[0]!.target, "caller");
  for (const [index, row] of rows.entries()) {
    if (row.name?.includes("[aforementioned]")) {
      assert.ok(row.aboveRow !== undefined && row.aboveRow < index);
      assert.equal(rows[row.aboveRow!]!.target, row.target);
      assert.doesNotMatch(
        rows[row.aboveRow!]!.text,
        /\[aforementioned\]|\[loop\]/,
      );
    } else assert.equal(row.aboveRow, undefined);
  }
  assert.match(rows.map((row) => row.text).join("\n"), /caller\(\) \[loop\]/);
  assert.equal(
    rows.filter((row) => row.name?.includes("func2() [aforementioned]")).length,
    1,
  );
  assert.equal(rows.find((row) => row.target === "focus")!.bold, true);
  assert.equal(rows.find((row) => row.target === "callee1")!.bold, false);
  assert.ok(fileHierarchy(data, "selected.ts").every((row) => !row.bold));
  assert.match(
    rows.find((row) => row.target === "focus")!.pathText!,
    /^ +selected\.ts:/,
  );
});

test("hierarchy stops at ten links and reports truncation", () => {
  const edges: [string, string][] = Array.from({ length: 15 }, (_, i) => [
    `n${i}`,
    `n${i + 1}`,
  ]);
  const rows = fileHierarchy(graph(edges, "n0"), "selected.ts");
  assert.equal(rows.length, 11);
  assert.match(rows.at(-1)!.text, /n10\(\) \[depth limit\]/);
  const callers = fileHierarchy(graph(edges, "n15"), "selected.ts");
  assert.equal(callers[0]!.target, "n5");
  assert.equal(callers.at(-1)!.target, "n15");
});

test("hierarchy handles self calls, duplicate links, objects, and empty files", () => {
  const data = graph([
    ["focus", "focus"],
    ["focus", "object"],
    ["focus", "object"],
  ]);
  data.declarations.get("object")!.kind = "object";
  data.connections[1]!.kind = "reference";
  const rows = fileHierarchy(data, "selected.ts");
  assert.equal(rows.length, 3);
  assert.match(rows[1]!.text, /focus\(\) \[loop\]/);
  assert.match(rows[2]!.text, /^    object +other.ts/);
  assert.equal(fileHierarchy(data, "empty.ts")[0]!.text, "(no declarations)");
});

test("focused hierarchy prunes unrelated caller branches but preserves all target descendants", () => {
  const data = graph([
    ["caller", "unrelated"],
    ["unrelated", "unrelatedChild"],
    ["caller", "middle"],
    ["middle", "sibling"],
    ["middle", "focus"],
    ["focus", "callee"],
    ["callee", "unrelated"],
    ["focus", "secondCallee"],
  ]);
  data.declarations.set("otherInFile", {
    ...data.declarations.get("focus")!,
    id: "otherInFile",
    name: "otherInFile",
  });
  const rows = fileHierarchy(data, "selected.ts", "focus");
  assert.deepEqual(
    rows.map((row) => row.target),
    [
      "caller",
      "middle",
      "focus",
      "callee",
      "unrelated",
      "unrelatedChild",
      "secondCallee",
    ],
  );
  assert.ok(rows[2]!.bold);
  assert.ok(rows.every((row) => row.target === "focus" || !row.bold));
});
