import assert from "node:assert/strict";
import { test } from "node:test";
import { fileHierarchy } from "../src/hierarchy.js";
import { jsonHierarchy } from "../src/json-output.js";
import type { Snapshot } from "../src/model.js";

test("JSON preserves hierarchy limits, loops, repeated nodes and excludes connections absent from the text view", () => {
  const ids = Array.from({ length: 13 }, (_, index) => `item${index}`);
  const snapshot: Snapshot = {
    root: "/project",
    files: ["main.ts"],
    warnings: ["A dependency could not be resolved."],
    declarations: new Map(
      ids.map((id, index) => [
        id,
        {
          id,
          name: id,
          file: "main.ts",
          kind: "function",
          line: index + 1,
          start: index * 20,
          end: index * 20 + 19,
        },
      ]),
    ),
    connections: [
      {
        from: "item0",
        label: "externalLibrary",
        kind: "call",
        status: "external",
        line: 1,
      },
      ...ids.slice(1).map((to, index) => ({
        from: ids[index],
        to,
        label: to,
        kind: "call" as const,
        status: "resolved" as const,
        line: index + 1,
      })),
      {
        from: "item0",
        to: "item0",
        label: "item0",
        kind: "call",
        status: "resolved",
        line: 1,
      },
      {
        from: "item0",
        to: "item2",
        label: "item2",
        kind: "call",
        status: "resolved",
        line: 1,
      },
      {
        from: "item0",
        label: "dynamic",
        kind: "call",
        status: "unresolved",
        line: 1,
      },
    ],
  };
  const result = jsonHierarchy(snapshot, "item0");
  assert.equal(result.status, "ok");
  assert.ok("hierarchy" in result);
  type Node = (typeof result.hierarchy)[number];
  const flatten = (nodes: Node[]): Node[] =>
    nodes.flatMap((node) => [node, ...flatten(node.child)]);
  const flattened = flatten(result.hierarchy);
  assert.deepEqual(
    result.hierarchy[0].child.map((node) => node.name),
    ["item1", "item0", "item2"],
  );
  assert.equal(result.hierarchy[0].child[0].child[0].name, "item2");
  assert.ok(
    flattened
      .filter((node) => node.stopReason)
      .every((node) => node.child.length === 0),
  );
  assert.ok(flattened.some((row) => row.stopReason === "depth_limit"));
  assert.ok(flattened.some((row) => row.stopReason === "loop"));
  const repeated = flattened.find(
    (row) => row.stopReason === "aforementioned",
  )!;
  assert.equal(flattened[repeated.originalRow!].name, repeated.name);
  const displayed = fileHierarchy(snapshot, "main.ts", "item0");
  assert.deepEqual(
    flattened.map((row) => row.name),
    displayed.map((row) => snapshot.declarations.get(row.target!)!.name),
  );
  assert.equal(result.hierarchy[0].path, "/project/main.ts");
  assert.ok(!("connections" in result));
  assert.ok(!("warnings" in result));
  assert.ok(!("scope" in result));
  assert.doesNotMatch(
    JSON.stringify(result),
    /dynamic|externalLibrary|item11|item12/,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});
