#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { findDeclaration } from "./find-declaration.js";
import { fileHierarchy } from "./hierarchy.js";
import { runAnalysis } from "./run-analysis.js";
import { safeText } from "./display.js";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

try {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      plain: { type: "boolean" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(`Usage: cvis <path/file> <name> [--plain]

Explore .ts, .tsx, .mts and .cts files, excluding declaration-only files.
A function or object name is required and matches exactly, including case.
Unknown or duplicate names print a message. Quote names containing spaces.

  ↑/↓, j/k       Move or scroll
  l, Enter       Open a declaration or connection
  h, Escape      Return to the previous page
  ←/→            Scroll source sideways
  PgUp/PgDn      Scroll a page
  g/G            First/last row, or jump to [above] with g
  q              Quit
  Ctrl+C         Clear the terminal and quit

--plain          Print the hierarchy without interaction
--version, -v    Print version
--help, -h       Show help

Piped output is automatically plain text. Analysis stays local. Saved analysis under ~/.cvis/analysis/ is checked before reuse.
Source is read from original files when opened. Keep files unchanged while browsing.
Connections describe source declarations, not guaranteed runtime behavior.
Only resolved connections within the selected file or folder are shown.`);
  } else if (values.version) {
    const metadata: { version: string } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    console.log(metadata.version);
  } else {
    if (positionals.length !== 2 || !positionals[1]?.trim())
      throw new Error(
        "Provide a TypeScript file or folder and a required function or object name. Run cvis --help for usage.",
      );
    const name = positionals[1];
    const interactive =
      !values.plain && !!process.stdin.isTTY && !!process.stdout.isTTY;
    if (interactive) {
      const [{ render }, { Explorer }, { ReadingProgress }] = await Promise.all(
        [import("ink"), import("./ui.js"), import("./reading-progress.js")],
      );
      let interrupted = false;
      const onInterrupt = () => {
        interrupted = true;
      };
      const app = render(<ReadingProgress onInterrupt={onInterrupt} />, {
        exitOnCtrlC: false,
        incrementalRendering: true,
        maxFps: 60,
      });
      const controller = new AbortController();
      const exited = app.waitUntilExit().then(() => controller.abort());
      try {
        const snapshot = await runAnalysis(
          positionals[0],
          (progress) => {
            app.rerender(
              <ReadingProgress progress={progress} onInterrupt={onInterrupt} />,
            );
          },
          controller.signal,
        );
        const match = findDeclaration(snapshot, name);
        if (match.message !== undefined) {
          app.clear();
          app.unmount();
          await exited;
          console.log(match.message);
        } else {
          app.rerender(
            <Explorer
              snapshot={snapshot}
              initialHierarchyTarget={match.declaration.id}
              onInterrupt={onInterrupt}
            />,
          );
          await exited;
        }
      } catch (error) {
        app.clear();
        app.unmount();
        if (controller.signal.aborted) process.exitCode = 130;
        else throw error;
      } finally {
        if (interrupted) {
          process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
          process.exitCode = 130;
        }
      }
    } else {
      const snapshot = await runAnalysis(positionals[0]);
      const match = findDeclaration(snapshot, name);
      if (match.message !== undefined) console.log(match.message);
      else {
        const rows = fileHierarchy(
          snapshot,
          match.declaration.file,
          match.declaration.id,
        );
        console.log(rows.map((row) => row.text).join("\n"));
      }
    }
  }
} catch (error) {
  console.error(
    `cvis: ${safeText(error instanceof Error ? error.message : String(error))}`,
  );
  process.exitCode = 1;
}
