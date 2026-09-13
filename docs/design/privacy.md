# Local source privacy

## Information handled

cvis reads the selected source files, project settings, imports, and dependency declarations. Analysis remains in the local process. It does not upload source, run a server, or use browser storage. No source copies are written to disk.

## Boundaries

Directory discovery skips symbolic links, hidden folders, dependencies, and common build folders. An explicitly selected path is resolved to its real location. TypeScript can read dependencies and configuration outside the selection for resolution, but the source viewer only opens declarations in selected files.

Selected scripts, application code, configuration plugins, and dependency installation are never executed. Project configuration is read as data. Filenames and source text have terminal controls escaped before display.

## Limits and errors

Discovery allows 10,000 files, 128 MiB of source, 2 MiB per file, and 40 directory levels. Exceeding the overall discovery limit fails with a request to choose a smaller folder. Oversized individual files and deep directories produce warnings. Symbolic links are counted in a warning. Unreadable discovery paths fail visibly.

Analysis reads at most 256 MiB of file content, with the same per-file limit. The size is checked before reading. Configuration and dependency files count toward this limit. Read-limit warnings and unresolved connections identify incomplete analysis.

The analysis worker uses a 16 MiB call stack and Node’s default JavaScript memory allowance. These settings do not cap total process memory. Worker failures are reported to the user.

## Source retention

The agreed design reads original source files only when needed for analysis or when the user opens source. It does not save source copies under `~/.cvis/` or retain a complete source snapshot for viewing. Assume project files stay unchanged during browsing, and restart analysis after edits. Source text for a view is released when that view closes. File read failures must be visible to the user.

Analysis records are retained under `~/.cvis/analysis/` across runs, without complete source text. They include file paths, declaration names and positions, call labels, connections, warnings, dependency relationships, and input checksums. The files use owner-only permissions. Delete that directory to clear them. Analysis results are also held in memory while browsing. Temporary compiler data is released when the analysis worker exits. cvis does not modify selected files. Explicit output redirection writes a hierarchy wherever the user requests it. Terminal scrollback may retain displayed source.
