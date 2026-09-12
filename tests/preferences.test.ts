import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  preferencesSchema,
  reconcilePreferences,
} from "../src/features/graph/preferences";
import type { Graph } from "../src/shared/graph";
test("refresh preserves unique identities and drops missing or ambiguous layout entries", () => {
  const graph = {
    files: [{ id: "a.ts" }],
    declarations: [
      { id: "a.ts::function:save#0" },
      { id: "a.ts::function:duplicate#0" },
      { id: "a.ts::function:duplicate#1" },
    ],
  } as Graph;
  const input = {
    ...defaults,
    positions: {
      "a.ts": { x: 10, y: 20 },
      "a.ts::function:save#0": { x: 1, y: 2 },
      "a.ts::function:duplicate#0": { x: 4, y: 5 },
      gone: { x: 1, y: 1 },
    },
    pins: ["a.ts::function:save#0", "a.ts::function:duplicate#0", "gone"],
  };
  const result = reconcilePreferences(input, graph);
  assert.deepEqual(Object.keys(result.positions), [
    "a.ts",
    "a.ts::function:save#0",
  ]);
  assert.deepEqual(result.pins, ["a.ts::function:save#0"]);
  assert(
    !preferencesSchema.safeParse({
      ...defaults,
      positions: { bad: { x: "bad", y: 0 } },
    }).success,
  );
});
