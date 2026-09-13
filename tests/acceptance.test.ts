import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Acceptance } from "../src/acceptance.js";
import type { Snapshot } from "../src/model.js";

test("acceptance persists by exact code across offsets and selected roots, and toggles off", () => {
  const root = mkdtempSync(join(tmpdir(), "cvis-accept-"));
  const directory = join(root, "accepted");
  const code = "function run() { return 42; }";
  const snapshot = (prefix = "", body = code): Snapshot => {
    writeFileSync(join(root, "main.ts"), prefix + body);
    return {
      root,
      files: ["main.ts"],
      warnings: [],
      connections: [],
      declarations: new Map([
        [
          "run",
          {
            id: "run",
            file: "main.ts",
            name: "run",
            kind: "function",
            start: prefix.length,
            end: prefix.length + body.length,
            line: 1,
          },
        ],
      ]),
    };
  };
  try {
    const first = new Acceptance(snapshot(), directory);
    assert.equal(first.toggle("run"), true);
    assert.equal(
      readFileSync(join(directory, readdirSync(directory)[0]!), "utf8"),
      createHash("sha256").update(code).digest("hex"),
    );
    const shifted = snapshot("// unrelated edit\n");
    const relocated: Snapshot = {
      ...shifted,
      root: join(root, ".."),
      declarations: new Map([
        [
          "new-id",
          {
            ...shifted.declarations.get("run")!,
            id: "new-id",
            file: join(root.split("/").at(-1)!, "main.ts"),
          },
        ],
      ]),
    };
    assert.equal(
      new Acceptance(relocated, directory).accepted.has("new-id"),
      true,
    );
    assert.equal(
      new Acceptance(snapshot("", code.replace("42", "43")), directory).accepted
        .size,
      0,
    );
    const restored = new Acceptance(snapshot(), directory);
    assert.equal(restored.accepted.has("run"), true);
    assert.equal(restored.toggle("run"), false);
    assert.equal(new Acceptance(snapshot(), directory).accepted.size, 0);
    const blocked = join(root, "blocked");
    writeFileSync(blocked, "file");
    const failed = new Acceptance(snapshot(), blocked);
    assert.throws(() => failed.toggle("run"));
    assert.equal(failed.accepted.size, 0);
    new Acceptance(snapshot(), directory).toggle("run");
    const saved = join(directory, readdirSync(directory)[0]!);
    writeFileSync(saved, "corrupt");
    const corrupt = new Acceptance(snapshot(), directory);
    assert.equal(corrupt.accepted.size, 0);
    assert.match(corrupt.warning!, /Could not read/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
