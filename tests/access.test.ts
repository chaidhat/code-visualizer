import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateLocal } from "../src/server/access";
import { discover, contained } from "../src/server/analysis/discover";
test("strict local host, origin and session checks", () => {
  process.env.VISUALIZER_TOKEN = "a".repeat(64);
  const good = {
    host: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    "x-local-session": "a".repeat(64),
  };
  const req = (headers: Record<string, string>) =>
    new Request("http://127.0.0.1:3000/api/projects", { headers });
  assert.doesNotThrow(() => validateLocal(req(good)));
  for (const change of [
    { host: "evil.example:3000" },
    { origin: "https://evil.example" },
    { "x-local-session": "" },
    { "sec-fetch-site": "cross-site" },
    { host: "127.0.0.1.evil.example:3000" },
  ])
    assert.throws(
      () =>
        validateLocal(req({ ...good, ...change } as Record<string, string>)),
      /Access denied/,
    );
});
test("discovery excludes sensitive files, outside links, cycles and oversized files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "visualizer-access-"));
  try {
    fs.writeFileSync(path.join(root, "ok.ts"), "function ok(){}");
    fs.writeFileSync(path.join(root, ".env"), "SECRET");
    fs.writeFileSync(path.join(root, "id_rsa"), "SECRET");
    fs.writeFileSync(
      path.join(root, "big.ts"),
      " ".repeat(2 * 1024 * 1024 + 1),
    );
    fs.symlinkSync(root, path.join(root, "cycle"));
    fs.symlinkSync("/etc", path.join(root, "outside"));
    const found = discover(root, () => {});
    assert.equal(found.files.filter((f) => f.supported).length, 1);
    assert.equal(found.skipped["Symbolic link"], 2);
    assert.equal(found.skipped["Excluded or private"], 2);
    assert.equal(found.skipped["File size limit"], 1);
    assert(!contained(root, path.join(root, "../escape")));
    assert(!contained(root, `${root}-other/file`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("request bodies are bounded even without a length header", async () => {
  const { readSmallJson } = await import("../src/server/requestBody");
  assert.deepEqual(
    await readSmallJson(
      new Request("http://127.0.0.1:3000", {
        method: "POST",
        body: '{"root":"/tmp"}',
      }),
    ),
    { root: "/tmp" },
  );
  await assert.rejects(
    readSmallJson(
      new Request("http://127.0.0.1:3000", {
        method: "POST",
        body: "x".repeat(9000),
      }),
    ),
    /too large/,
  );
});
