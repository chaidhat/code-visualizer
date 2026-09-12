# Local project privacy

## Scope

Code Visualizer reads source code from a user-selected local folder to construct a map. This design applies to the local Next.js app and its analysis workers.

## Information handled

The server reads source files, filenames, configuration, and dependency declarations needed by TypeScript. The browser receives relative paths, declaration names, connections, diagnostics, and requested source snippets. The folder picker shows local directory names so the user can choose a root.

Source remains on the user's machine. Do not add hosted analysis, AI requests, telemetry, or third-party page scripts to this workflow. Disable Next.js telemetry in the documented startup setup. Dependency installation is a separate network activity and must not include selected project content.

## Access boundaries

Bind to loopback and require the per-run local session token and accepted Host and Origin on filesystem routes. After selection, scope graph and source reads to the registered project. Resolve symbolic links before checking boundaries. Folder browsing exposes directories, not arbitrary file contents.

TypeScript may need configuration and dependency declarations beyond the selected root. Allow only documented analysis resolution reads, with depth and size limits. Keep these outside the browser source route. Never execute project scripts or plugins.

## Retention and deletion

Hold source and graph snapshots in bounded server memory. Release superseded or cancelled project contexts, terminate workers on shutdown, and do not write source caches to disk in the first version.

Persist only layout preferences in browser storage. Project labels and declaration identifiers can still reveal names, so provide Clear saved layout and explain what it removes. Logs contain bounded diagnostics and counts, not source text, environment values, or source snippets.

## Verification

Before release, verify cross-origin rejection, session checks, path containment, symbolic-link behavior, excluded sensitive files, bounded reads, cancellation cleanup, and absence of source-bearing network requests to external services.

## Implemented limits

Discovery excludes dependency folders, common build and cache folders, private-key and environment files, known binary formats, and all symbolic links. Unsupported file types remain discoverable by name. Discovery is bounded at 10,000 file records, 128 MiB of supported source, 2 MiB per file, and 40 nested folders. Skipped counts and unreadable entries are reported.

TypeScript reads at most 256 MiB per analysis context set, with a 2 MiB per-file limit. Inside the selected root it can read non-excluded source and configuration. Outside the selected root it can read only dependency declarations and JSON under `node_modules`, plus TypeScript's own declaration libraries. Project settings are parsed as data. Plugins and project scripts are not loaded. External source summaries cannot be opened in the source panel.

Only one project is retained in server memory. A new selection releases its predecessor. Analysis has a five-minute processing limit and a 1 GiB worker heap limit. Idle project results expire after 30 minutes, and stopping the server releases its workers. No source cache is written to disk. Source snippets are bounded to 201 requested lines plus context and checked against the analyzed content hash.

The app sets a browser policy that restricts network connections and page assets to the local origin. Frames, external form submissions, and referrer sharing are blocked. The development server needs inline scripts and evaluation for its development tooling. Session keys are generated at startup and kept in page memory, never in persisted layouts.
