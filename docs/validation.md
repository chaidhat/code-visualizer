# Terminal tool validation

## Environment

Checked September 12, 2026 on macOS arm64, Apple M4, Node.js 25.2.1. The package declares Node.js 22 or newer. Other supported Node.js versions and Windows terminals have not been tested here.

The previous browser application and its results are superseded by the terminal implementation requested in `prompt2.md`.

## Automated checks

Type checking, build, and 14 automated tests passed. Tests cover import aliases and re-exports, both conditional branches, nested callback ownership, cross-file object and type references, methods and constructors, recursion, dynamic calls, detected reassignment, separate project settings, overload implementation selection, file selection boundaries, complete source snapshots, discovery exclusions, symbolic-link cycles, malformed settings, malformed source, terminal control escaping, class expressions, and missing import warnings.

Interaction tests cover moving with letters and arrow keys, opening declarations and connection targets, scrolling to the end of a long declaration, restoring the previous selected row, and quitting.

`npm run smoke` exercises the built command and its worker. It checks plain output, incoming and outgoing links, help, version, missing and invalid arguments, paths with spaces, missing paths, and malformed settings in the worker. The checks passed, including repeated runs of worker-failure handling.

## Terminal check

Ran the built command in a real terminal against `examples/branching`. Verified that `j` changes the highlighted row, Enter opens complete source with line numbers, `h` restores the selected outline row, and `q` exits successfully and restores the cursor. The captured terminal output contains the expected inverse-color selection controls.

The example shows resolved incoming and outgoing calls and an explicitly unresolved conditional function alias. No browser is involved.

## Packaging check

`npm pack --dry-run` confirms the executable, analysis worker, remaining runtime modules, README, and package metadata are included. The build marks the command executable.

A real tarball was installed into a separate temporary project with install scripts disabled. `npx --no-install cvis` from that project successfully analyzed the example and returned its expected incoming and outgoing links. No npm package was published.

## Synthetic performance

Each case runs in a fresh process and uses ten functions per file. Every function calls another function in its file and an imported function in the next file. The imports form a cycle through the entire folder. These are measured results, not promises for every repository.

### Small

10 files, 100 declarations, 200 connections, and 511 display rows. Analysis including worker startup and result transfer took 501 ms. Outline construction took 1 ms. Total process time was 559 ms. Peak process resident memory was 322 MiB.

### Medium

500 files, 5,000 declarations, 10,000 connections, and 25,501 display rows. Analysis including worker startup and result transfer took 714 ms. Outline construction took 20 ms. Total process time was 799 ms. Peak process resident memory was 391 MiB.

### Large

2,000 files, 20,000 declarations, 40,000 connections, and 102,001 display rows. Analysis including worker startup and result transfer took 3,723 ms. Outline construction took 188 ms. Total process time was 4,049 ms. Peak process resident memory was 465 MiB.

### What the measurements cover

The benchmark reports peak resident memory through Node.js `process.resourceUsage().maxRSS`. Each case is isolated in its own process. Analysis includes the worker's TypeScript import and its snapshot transfer. Total process time also includes command startup and outline formatting. It excludes fixture creation and interactive terminal rendering.

Opening a cached short declaration averaged below 0.002 ms over 1,000 iterations in these cases. This measures source slicing and row preparation, not terminal drawing or large declaration performance. The viewer renders only the visible rows, but no universal input-latency guarantee has been established.

The first 2,000-file attempt overflowed TypeScript's call stack in the main thread. Moving analysis into a worker with a 16 MiB stack allowed the same fixture to complete. The benchmark keeps that long import cycle as a regression case.

## Known limits

The tool resolves source declarations, not all runtime implementations. Conditional function aliases, reflection, external callback execution, runtime mutation, interface dispatch, and inheritance overrides may remain unresolved or differ from the declared target. It does not perform a full project type-check or build referenced projects.

The 10,000-file discovery ceiling is a safety boundary, not a proven performance target. Terminal resizing is implemented through Ink's output size events, but a range of terminal emulators and physical resize interactions have not been manually tested. Source is read from original files when opened. Files are assumed unchanged during browsing, and analysis requires a restart after edits.

## Scrolling update

The viewer now holds its position until the selection crosses a visible edge. Returning from source restores both selection and scroll position. Unchanged rows are reused, and Ink updates only changed lines with a maximum refresh rate of 60 updates per second.

A real terminal check sent 15 downward moves within a 24-row, 100-column view. With the previous drawing settings, output totaled 10,642 bytes and 360 whole-line clears. With the new settings, output totaled 3,162 bytes and zero whole-line clears. Both runs used the new edge-based scrolling behavior to isolate the drawing-settings comparison. Every key registered, and the new mode did not repaint the header during those moves.

The same check resized the terminal to 12 rows and 70 columns, opened source, returned, and exited successfully. An automated test also checks that moving within the page does not scroll it, crossing the bottom scrolls one row, reversing direction does not jump, and returning from source restores the page position. These checks verify reduced redraw work and correct navigation, not subjective smoothness across all terminal applications.

## Startup progress

Added tests for counting selected files exactly once, excluding imported files outside a single-file selection from the total, and displaying discovery, partial reading, complete reading, and empty selections. All 14 tests, type checking, build, formatting, and command checks passed.

A real terminal run with 400 selected files displayed 0/400 through 400/400, followed by Analyzing and the results. A separate terminal check confirmed Ctrl+C cancels loading with exit code 130 after keyboard handling is active. Progress messages are limited to one per 50 ms, with initial and complete counts always sent. Plain output receives no progress text.

## Saved analysis and selective reanalysis

All 38 tests, type checking, build, and formatting checks pass. Cache tests cover unchanged reuse, content changes with preserved timestamps and file sizes, file additions and deletions, settings and dependency changes, missing imports, damaged data, failed writes, changes during analysis, transitive callers, cycles, separate project settings, stale warning removal, and global declarations introduced or removed through imports.

A built-worker check analyzed three files, changed one dependency, and then restarted twice. The changed run analyzed two files and reused one. The unchanged run analyzed zero files and reused all three. Selectively combined declarations and connections are also compared against fresh analysis in tests.

An unchanged run against the 1,045-file Schols worktree reused all files and completed in about 0.5 seconds, compared with about 11 seconds for the preceding full analysis on this machine. These are observed runs, not performance guarantees. Selective extraction still requires TypeScript to load the relevant project contexts.
