import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceRows, sourceSegments } from "../src/display.js";
import { syntaxSpans } from "../src/syntax.js";

test("Prism colors TypeScript and TSX, including multiline text", () => {
  const source =
    'const view = <div title="hello">{42}</div>; /* first\nsecond */';
  const spans = syntaxSpans(source, "view.tsx");
  for (const [text, color] of [
    ["const", "magenta"],
    ["div", "cyan"],
    ["42", "yellow"],
    ["/* first\nsecond */", "gray"],
  ]) {
    assert.ok(
      spans.some(
        (span) =>
          source.slice(span.start, span.end) === text && span.color === color,
      ),
      text,
    );
  }
});

test("source colors preserve safe text, multiline context, references and sideways scrolling", () => {
  const root = mkdtempSync(join(tmpdir(), "cvis-syntax-"));
  const source =
    'function run() {\r\n\t/* first\r\n\tsecond */\r\n\tconst text = `hello\r\nworld`;\r\n\t"\x1b[31m"; run();\r\n}';
  writeFileSync(join(root, "main.ts"), source);
  try {
    const start = source.lastIndexOf("run");
    const rows = sourceRows(
      {
        root,
        files: ["main.ts"],
        warnings: [],
        connections: [],
        declarations: new Map([
          [
            "run",
            {
              id: "run",
              name: "run",
              file: "main.ts",
              kind: "function",
              start: 0,
              end: source.length,
              line: 1,
            },
          ],
        ]),
        references: new Map([
          ["main.ts", [{ start, end: start + 3, from: "run", to: "run" }]],
        ]),
      },
      "run",
      new Set(["run"]),
    );
    assert.ok(
      rows[2].syntax?.some(
        (span) =>
          span.color === "gray" &&
          rows[2].text.slice(span.start, span.end).includes("second"),
      ),
    );
    assert.ok(
      rows[4].syntax?.some(
        (span) =>
          span.color === "green" &&
          rows[4].text.slice(span.start, span.end).includes("world"),
      ),
    );
    const row = rows[5];
    assert.ok(!row.text.includes("\x1b"));
    assert.ok(row.text.includes("\\u001b"));
    const reference = sourceSegments(row, 0).find(
      (segment) => segment.highlighted,
    );
    assert.equal(reference?.text, "run");
    for (const row of rows) {
      for (let offset = 0; offset <= row.text.length + 2; offset++) {
        assert.equal(
          sourceSegments(row, offset)
            .map((segment) => segment.text)
            .join(""),
          row.text.slice(offset),
        );
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
