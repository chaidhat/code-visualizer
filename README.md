# cvis

Explore TypeScript files, calls, and object references in your terminal. Replaces the previous browser application.

## Run locally

Requires Node.js 22 or newer.

```sh
npm install
npm run build
npx --no-install cvis examples/branching submit
```

During development:

```sh
npm run dev -- examples/branching submit
npm run dev -- /absolute/path/to/project myFunction
npm run dev -- /absolute/path/to/file.ts myFunction
```

The package exposes the `cvis` command. After publishing this package under an available npm name, users can run `npx <package-name> <path/file> <name>`. This repository has not been published. Do not assume the public npm name `cvis` belongs to this project.

A function or object name is required:

```sh
npx cvis <folder> <name>
```

Omitting the name or passing an empty name rejects the command before reading files. Names match exactly, including capitalization. A name that is not found prints a message to standard output and exits. Duplicate names print their file locations instead of choosing one. With `--json` or redirected output, a matching name prints the hierarchy as one JSON result.

## Explore

Startup shows a progress bar with the number of selected TypeScript files read out of the discovered total. Each file is counted once. When reading reaches the total, the display says Analyzing until the results are ready. Press Ctrl+C to cancel loading. JSON output does not include the progress display.

```text
submit()    workflow.ts:3
    saveDraft()    actions.ts:1
```

Startup opens File hierarchy for the named function or object. Use the up and down arrows or `j` and `k` to move. The selected name has reversed foreground and background colors. Press `l`, Enter, or the right arrow to read its source. Press `h` or Escape to return to your previous selection. Back at the hierarchy keeps you there. Press `q` to quit. Cmd+C copies the selected file’s full path to your clipboard in the hierarchy when your terminal forwards the shortcut to cvis. Ctrl+C clears the terminal and quits in every view, including during loading.

Many terminals reserve Cmd+C for copying text selected with the mouse. To use it for the selected hierarchy row, configure the terminal to send `\x1b[99;9u` for Cmd+C, or forward Cmd+C using its enhanced keyboard support. cvis automatically detects supported terminals.

For VS Code, add this to Keyboard Shortcuts (JSON). It forwards Cmd+C when the terminal has focus and no text is selected, preserving normal copying of selected text:

```json
{
  "key": "cmd+c",
  "command": "workbench.action.terminal.sendSequence",
  "when": "terminalFocus && !terminalTextSelected",
  "args": { "text": "\u001b[99;9u" }
}
```

Callers and callees are discovered level by level, up to 10 links in each direction, then displayed as an indented call tree. Only caller branches leading to the requested declaration are shown above it. Below it, all callees are shown. Only the requested declaration is bold, with paths in muted grey. `[loop]` stops a circular branch, `[aforementioned]` points to a branch already expanded above. Selecting it highlights the original row if visible, and `g` jumps to that row. `[depth limit]` marks branches stopped at 10 links. The hierarchy uses only files included in the selected file or folder.

Source includes the complete declaration body. Identified function and object references appear in red, including repeated mentions. Comments and strings are not highlighted. Scroll vertically with `j` and `k`, and horizontally with the left and right arrows. Page Up, Page Down, Ctrl+U, and Ctrl+D move a page. `g` and `G` move to the first and last rows. Source is read directly from the original file when opened. Keep files unchanged while browsing, and restart the command after editing files.

Redirecting output automatically prints JSON. Use `--json` to request it explicitly. The old `--plaintext` and `--plain` flags are no longer supported.

```sh
npx --no-install cvis src fileHierarchy --json
npx --no-install cvis src fileHierarchy > hierarchy.json
```

JSON results have `version: 1` and a `status` of `ok`, `not_found`, `ambiguous`, or `error`. Successful results contain only the same hierarchy rows as the text view, in the same order. Each item includes its name, kind, file, full path, starting line, and stop marker. Children are nested in a `child` array, with `child: []` for leaves and stopped branches. The `hierarchy` array contains the roots. Item indices and references to original rows are zero-based in depth-first display order. External, unresolved, and other connections absent from the text view are excluded.

Unknown and ambiguous names include a message and matching declarations. Errors produce one JSON result and exit with status 1. Help and version remain ordinary text.

## What the connections mean

Indented rows show calls and references to functions, objects, classes, or types. Callers found within your selection appear above the requested declaration. Selecting a single file does not search the rest of the repository for its callers.

The tool uses TypeScript's own parser and name resolution without invoking `tsc`, emitting project output, or running a full type-check during browsing. It reads each folder's nearest `tsconfig.json`, including inherited settings and import aliases. It scans selected `.ts`, `.tsx`, `.mts`, and `.cts` files even if a configuration excludes them. Declaration-only files are not listed, but TypeScript can read them to resolve dependencies.

Functions, nested callbacks, methods, classes, object literals, object instances, interfaces, and type aliases are listed. Calls in every branch are inspected. Inline callbacks and local functions inside a function are folded into that surrounding function. Their calls appear directly under it, and its source preview still includes their full code. Top-level calls and object/class initializers appear under File initialization. Repeated connections are combined in the hierarchy. Overloaded calls open the implementation when available.

Only resolved connections within the selected files appear in the hierarchy. Dynamic property calls, function aliases and conditional choices, missing dependencies, and detected reassignment can prevent a connection from being resolved. Missing imports and malformed source produce visible warnings. Malformed project settings stop the command with an error.

Connections identify declarations in the source, not guaranteed runtime implementations or proof that a call executes. Interface dispatch, inheritance overrides, runtime mutation, callbacks invoked by libraries, and reflective code cannot be fully determined this way. Missing incoming arrows do not prove that a function is unused. Project references are not built. Each selected file uses its nearest configuration, while dependencies are resolved from the files already present on disk.

## Performance and privacy

Analysis runs in a separate worker with a larger call stack for long import chains and Node’s default memory allowance. TypeScript still needs memory for language analysis. The worker releases its compiler data and read cache when it exits. The viewer retains declaration and connection records, but no complete source snapshot. Source is read from the original file when opened, and formatted source rows are kept only for the current view. No source copies are written under `~/.cvis/`. Keep project files unchanged during browsing and restart after edits. Incoming links are indexed once, and only visible rows are rendered when moving the selection.

Discovery skips symbolic links, hidden folders, dependency folders, folders named `__tests__` or `test` at any depth, and common build outputs. Files inside `__tests__` or `test` are also excluded when selected directly. It allows up to 10,000 source files, 128 MiB of discovered source, 2 MiB per file, and 40 nested folders. Analysis reads up to 256 MiB, including configuration and dependencies. Limits and skipped symbolic links are reported. Unreadable discovery paths fail visibly.

All analysis is local. TypeScript may read imported files, dependency declarations, and inherited settings outside your selected folder. Only selected files can be opened in the viewer. The tool does not execute selected code, project scripts, or plugins, install project dependencies, upload source, or modify the selected project. Source and filenames are escaped before displaying terminal control characters.

## Development checks

```sh
npm run typecheck
npm test
npm run build
npm run smoke
npm run format:check
npm run benchmark
npm pack --dry-run
```

See [validation](docs/validation.md) for measured results and limits, and [design](docs/design/code-visualizer.md) for ownership and flow. Existing tools used are [TypeScript](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) and [Ink](https://github.com/vadimdemedes/ink).

## Saved analysis

cvis automatically saves analysis records under `~/.cvis/analysis/`. On the next run it checks file contents, settings, dependency reads, and import lookups before reusing results. Unchanged projects skip analysis. Changed modules and their dependent files are reanalyzed, while unrelated records are reused. The viewer shows how many files were reused.

Added or deleted files, shared settings, dependency changes, and global declarations can require a full rebuild. TypeScript may still load related code to understand a changed file. Saved results contain names, paths, connections, warnings, and checksums, but no full source copies. Source is read directly when opened. Delete `~/.cvis/analysis/` to clear saved analysis. Unreadable or damaged saved data produces a warning and a fresh analysis.

Press `y` on a highlighted item to toggle acceptance, or while reading its source to toggle that item. Accepted names appear green throughout the hierarchy. The original row for a selected repeated reference is highlighted blue. Acceptance is saved under `~/.cvis/accepted/` as SHA-256 hashes, without source copies. It survives restarts and different starting names or selected folders when the absolute file location, containing names, and exact declaration code match. Changes inside the declaration, including whitespace and comments, make it unaccepted. Changes outside it do not. Ambiguous names within the same containing scope and File initialization cannot be accepted.
