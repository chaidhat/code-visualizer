import assert from "node:assert/strict";
import path from "node:path";
const base = "http://127.0.0.1:3000";
const session = await fetch(`${base}/api/session`).then((r) => r.json());
assert(session.token);
const headers = {
  "x-local-session": session.token,
  "Content-Type": "application/json",
};
for (const endpoint of ["session", "directories", "projects"]) {
  const response = await fetch(`${base}/api/${endpoint}`, {
    headers: { origin: "https://example.com" },
  });
  assert.equal(response.status, 403);
}
assert.equal((await fetch(`${base}/api/directories`)).status, 403);
// Node fetch normalizes Host. A raw HTTP request exercises the actual header.
const { request: httpRequest } = await import("node:http");
assert.equal(
  await new Promise((resolve, reject) => {
    const req = httpRequest(
      `${base}/api/session`,
      { headers: { Host: "evil.example:3000" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  }),
  403,
);
const directories = await fetch(
  `${base}/api/directories?path=${encodeURIComponent(process.cwd())}`,
  { headers },
).then((r) => r.json());
assert(directories.directories.includes("src"));
const created = await fetch(`${base}/api/projects`, {
  method: "POST",
  headers,
  body: JSON.stringify({ root: path.resolve("examples/branching") }),
}).then((r) => r.json());
assert(created.id);
let status;
for (let i = 0; i < 100; i++) {
  status = await fetch(`${base}/api/projects/${created.id}`, { headers }).then(
    (r) => r.json(),
  );
  if (status.state !== "running") break;
  await new Promise((r) => setTimeout(r, 100));
}
assert.equal(status.state, "complete", JSON.stringify(status));
const graph = await fetch(`${base}/api/projects/${created.id}/graph`, {
  headers,
}).then((r) => r.json());
assert.equal(graph.files.filter((f) => f.supported).length, 2);
assert(graph.connections.some((e) => e.resolution === "possible"));
const evidence = graph.connections[0].evidence[0];
const source = await fetch(
  `${base}/api/projects/${created.id}/source?file=${encodeURIComponent(evidence.file)}&start=${evidence.line}&end=${evidence.endLine}`,
  { headers },
).then((r) => r.json());
assert(source.text);
assert.equal(
  (
    await fetch(
      `${base}/api/projects/${created.id}/source?file=../../package.json&start=1&end=1`,
      { headers },
    )
  ).status,
  400,
);
const cancelled = await fetch(`${base}/api/projects/${created.id}`, {
  method: "DELETE",
  headers,
}).then((r) => r.json());
assert.equal(cancelled.state, "cancelled");
console.log(
  `Live smoke checks passed: folder browsing, analysis, ${graph.declarations.length} declarations, ${graph.connections.length} connections, source evidence, cancellation, and rejected unauthorized requests.`,
);
