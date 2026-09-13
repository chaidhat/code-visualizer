import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { render } from "ink-testing-library";
import { Explorer } from "../src/ui.js";
import type { Snapshot } from "../src/model.js";

const sourceRoot = mkdtempSync(join(tmpdir(), "cvis-ui-"));
after(() => rmSync(sourceRoot, { recursive: true, force: true }));
writeFileSync(join(sourceRoot, "main.ts"), "function run() {\n  return 42;\n}");

const snapshot: Snapshot = {
  root: sourceRoot,
  files: ["main.ts"],
  warnings: [],
  declarations: new Map([
    [
      "run",
      {
        id: "run",
        file: "main.ts",
        name: "run",
        kind: "function",
        start: 0,
        end: 31,
        line: 1,
      },
    ],
  ]),
  connections: [],
};

test("keyboard opens source, returns to selection, and quits", async () => {
  const app = render(
    <Explorer snapshot={snapshot} initialHierarchyTarget="run" />,
  );
  try {
    await setTimeout(50);
    app.stdin.write("\r");
    await setTimeout(50);
    assert.match(app.lastFrame()!, /return 42/);
    app.stdin.write("h");
    await setTimeout(50);
    assert.doesNotMatch(app.lastFrame()!, /return 42/);
    app.stdin.write("l");
    await setTimeout(50);
    assert.match(app.lastFrame()!, /return 42/);
    app.stdin.write("q");
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test("arrow navigation opens connections and source can scroll to its end", async () => {
  const code = `function run() {\n${Array.from({ length: 80 }, (_, i) => `  // line ${i}`).join("\n")}\n}`;
  const longRoot = mkdtempSync(join(sourceRoot, "long-"));
  writeFileSync(join(longRoot, "main.ts"), code);
  const data: Snapshot = {
    ...snapshot,
    root: longRoot,
    declarations: new Map([
      ["run", { ...snapshot.declarations.get("run")!, end: code.length }],
    ]),
    connections: [
      {
        from: "run",
        to: "run",
        label: "run",
        kind: "call",
        status: "resolved",
        line: 1,
      },
    ],
  };
  const app = render(<Explorer snapshot={data} initialHierarchyTarget="run" />);
  try {
    await setTimeout(50);
    app.stdin.write("\x1b[B");
    await setTimeout(50);
    app.stdin.write("l");
    await setTimeout(50);
    assert.match(app.lastFrame()!, /function run/);
    app.stdin.write("G");
    await setTimeout(50);
    assert.match(app.lastFrame()!, /line 79/);
    app.stdin.write("h");
    await setTimeout(50);
    assert.match(app.lastFrame()!, /2\/2/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test("scrolling holds the page steady until an edge and restores it after opening source", async () => {
  const data: Snapshot = {
    ...snapshot,
    declarations: new Map(
      Array.from({ length: 60 }, (_, index) => [
        `item${index}`,
        {
          ...snapshot.declarations.get("run")!,
          id: `item${index}`,
          name: `item${index}`,
          start: index,
        },
      ]),
    ),
    connections: Array.from({ length: 59 }, (_, index) => ({
      from: "item0",
      to: `item${index + 1}`,
      label: `item${index + 1}`,
      kind: "call" as const,
      status: "resolved" as const,
      line: 1,
    })),
  };
  const app = render(
    <Explorer snapshot={data} initialHierarchyTarget="item0" />,
  );
  const press = async (input: string) => {
    app.stdin.write(input);
    await setTimeout(25);
  };
  const firstRow = () => app.lastFrame()!.split("\n")[2];
  try {
    await setTimeout(50);
    for (let i = 0; i < 15; i++) await press("j");
    assert.match(
      firstRow()!,
      /item0\(\)/,
      "moving within the visible page must not scroll it",
    );
    for (let i = 0; i < 5; i++) await press("j");
    assert.match(
      firstRow()!,
      /item1\(\)/,
      "crossing the bottom scrolls exactly one row",
    );
    await press("k");
    assert.match(
      firstRow()!,
      /item1\(\)/,
      "reversing direction must not jump the page",
    );
    await press("l");
    await press("h");
    assert.match(
      firstRow()!,
      /item1\(\)/,
      "returning restores the previous page position",
    );
    await press("g");
    assert.match(firstRow()!, /item0\(\)/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test("loading shows discovered totals and distinguishes reading from analysis", async () => {
  const { ReadingProgress } = await import("../src/reading-progress.js");
  const app = render(<ReadingProgress />);
  try {
    assert.match(app.lastFrame()!, /Finding TypeScript files/);
    app.rerender(<ReadingProgress progress={{ read: 3, total: 10 }} />);
    await setTimeout(30);
    assert.match(app.lastFrame()!, /\[=+ +\] 3\/10 TypeScript files read/);
    assert.doesNotMatch(app.lastFrame()!, /Analyzing/);
    app.rerender(<ReadingProgress progress={{ read: 10, total: 10 }} />);
    await setTimeout(30);
    assert.match(app.lastFrame()!, /10\/10 TypeScript files read · Analyzing/);
    app.rerender(<ReadingProgress progress={{ read: 0, total: 0 }} />);
    await setTimeout(30);
    assert.match(app.lastFrame()!, /0\/0 TypeScript files read/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test("Ctrl+C requests terminal clearing in hierarchy, source and during loading", async () => {
  const { ReadingProgress } = await import("../src/reading-progress.js");
  for (const view of ["hierarchy", "source", "loading"]) {
    const loading = view === "loading";
    let interrupted = false;
    const onInterrupt = () => {
      interrupted = true;
    };
    const app = render(
      loading ? (
        <ReadingProgress onInterrupt={onInterrupt} />
      ) : (
        <Explorer
          snapshot={snapshot}
          initialHierarchyTarget="run"
          onInterrupt={onInterrupt}
        />
      ),
    );
    try {
      await setTimeout(50);
      if (view === "source") {
        app.stdin.write("l");
        await setTimeout(50);
      }
      app.stdin.write("\x03");
      await setTimeout(30);
      assert.equal(interrupted, true);
    } finally {
      app.unmount();
      app.cleanup();
    }
  }
});

test("a startup target opens hierarchy and back never leaves it", async () => {
  const app = render(
    <Explorer snapshot={snapshot} initialHierarchyTarget="run" />,
  );
  try {
    await setTimeout(50);
    assert.match(app.lastFrame()!, /File hierarchy  main.ts/);
    assert.match(app.lastFrame()!, /run\(\) +main.ts:1/);
    app.stdin.write("h");
    await setTimeout(50);
    assert.match(app.lastFrame()!, /File hierarchy/);
    for (const key of ["\x1b", "\x1b[D", "d", "/", "\x10", "n", "N"]) {
      app.stdin.write(key);
      await setTimeout(30);
      assert.match(app.lastFrame()!, /File hierarchy/);
      assert.match(app.lastFrame()!, /run\(\) +main.ts:1/);
    }
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test("g follows above rows, including offscreen origins, and otherwise goes to the top", async () => {
  const ids = [
    "root",
    "shared",
    ...Array.from({ length: 25 }, (_, i) => `branch${i}`),
  ];
  const data: Snapshot = {
    ...snapshot,
    declarations: new Map(
      ids.map((id, start) => [
        id,
        { ...snapshot.declarations.get("run")!, id, name: id, start },
      ]),
    ),
    connections: [
      ...ids.slice(1).map((to) => ({
        from: "root",
        to,
        label: to,
        kind: "call" as const,
        status: "resolved" as const,
        line: 1,
      })),
      {
        from: "branch24",
        to: "shared",
        label: "shared",
        kind: "call",
        status: "resolved",
        line: 1,
      },
    ],
  };
  const app = render(
    <Explorer snapshot={data} initialHierarchyTarget="root" />,
  );
  const press = async (key: string) => {
    app.stdin.write(key);
    await setTimeout(50);
  };
  try {
    await setTimeout(50);
    await press("G");
    assert.match(app.lastFrame()!, /shared\(\) \[aforementioned\]/);
    assert.match(app.lastFrame()!, /28\/28/);
    await press("g");
    assert.match(app.lastFrame()!, /2\/28/);
    assert.match(app.lastFrame()!, /shared\(\) +main.ts/);
    await press("g");
    assert.match(app.lastFrame()!, /1\/28/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test("y saves acceptance, restores it in a new view, and toggles it off", async () => {
  const { Acceptance } = await import("../src/acceptance.js");
  const directory = join(sourceRoot, "acceptance");
  const open = () =>
    render(
      <Explorer
        snapshot={snapshot}
        initialHierarchyTarget="run"
        acceptanceDirectory={directory}
      />,
    );
  let app = open();
  try {
    await setTimeout(50);
    app.stdin.write("y");
    await setTimeout(50);
    assert.match(app.lastFrame()!, /Accepted/);
    assert.equal(new Acceptance(snapshot, directory).accepted.has("run"), true);
    app.unmount();
    app.cleanup();
    app = open();
    await setTimeout(50);
    app.stdin.write("y");
    await setTimeout(50);
    assert.match(app.lastFrame()!, /Acceptance removed/);
    assert.equal(new Acceptance(snapshot, directory).accepted.size, 0);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test("source opens at the first child and visits every mention in both directions", async () => {
  const { analyze } = await import("../src/analyze.js");
  const root = mkdtempSync(join(sourceRoot, "children-"));
  writeFileSync(
    join(root, "main.ts"),
    [
      "function child() {}",
      "function other() {}",
      "function parent() {",
      ...Array.from({ length: 25 }, () => "  // child() is only a comment"),
      "  child(); child();",
      ...Array.from({ length: 25 }, () => "  // gap"),
      "  other();",
      "}",
    ].join("\n"),
  );
  const data = analyze(root);
  const parent = [...data.declarations.values()].find(
    (item) => item.name === "parent",
  )!;
  const app = render(
    <Explorer snapshot={data} initialHierarchyTarget={parent.id} />,
  );
  const press = async (key: string) => {
    app.stdin.write(key);
    await setTimeout(50);
  };
  try {
    await setTimeout(50);
    await press("l");
    assert.match(app.lastFrame()!, /27\/54  Child 1\/3/);
    assert.match(app.lastFrame()!, /child\(\); child\(\);/);
    await press("N");
    assert.match(app.lastFrame()!, /Child 1\/3/);
    await press("n");
    assert.match(app.lastFrame()!, /27\/54  Child 2\/3/);
    await press("n");
    assert.match(app.lastFrame()!, /53\/54  Child 3\/3/);
    assert.match(app.lastFrame()!, /other\(\);/);
    await press("n");
    assert.match(app.lastFrame()!, /Child 3\/3/);
    await press("N");
    assert.match(app.lastFrame()!, /27\/54  Child 2\/3/);
    await press("N");
    assert.match(app.lastFrame()!, /Child 1\/3/);
    await press("h");
    assert.match(app.lastFrame()!, /File hierarchy/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});

test("Cmd+C copies the selected absolute file path and reports clipboard failures without exiting", async () => {
  const copied: string[] = [];
  let fail = false;
  let interrupted = false;
  const data: Snapshot = {
    ...snapshot,
    declarations: new Map([
      ...snapshot.declarations,
      [
        "child",
        {
          ...snapshot.declarations.get("run")!,
          id: "child",
          name: "child",
          file: "folder with spaces/child.ts",
        },
      ],
    ]),
    connections: [
      {
        from: "run",
        to: "child",
        label: "child",
        kind: "call",
        status: "resolved",
        line: 1,
      },
    ],
  };
  const app = render(
    <Explorer
      snapshot={data}
      initialHierarchyTarget="run"
      onInterrupt={() => {
        interrupted = true;
      }}
      copyText={async (text) => {
        if (fail) throw new Error("clipboard unavailable");
        copied.push(text);
      }}
    />,
  );
  const press = async (key: string) => {
    app.stdin.write(key);
    await setTimeout(50);
  };
  try {
    await setTimeout(50);
    await press("j");
    await press("\x1b[99;9u");
    assert.deepEqual(copied, [join(sourceRoot, "folder with spaces/child.ts")]);
    assert.match(app.lastFrame()!, /File path copied/);
    assert.equal(interrupted, false);
    fail = true;
    await press("\x1b[99;9u");
    assert.match(app.lastFrame()!, /Could not copy file path/);
    assert.equal(interrupted, false);
    await press("k");
    fail = false;
    await press("\x1b[99;9u");
    assert.equal(copied[1], join(sourceRoot, "main.ts"));
    assert.match(app.lastFrame()!, /File hierarchy/);
  } finally {
    app.unmount();
    app.cleanup();
  }
});
