# Current behavior

Run `npx cvis <path/file> <name>` to open the hierarchy for an exact function or object name. Both arguments are required. Omitted or empty names reject the command before analysis. Unknown or duplicate names print a message.

Only hierarchy and source views are available. There is no file list, file expansion, or list search. Use arrows or `j` and `k` to move, `l` or Enter to read source, and `h` or Escape to return. Back from hierarchy stays there. Keep scrolling, source reference colors, focused hierarchy branches, and jumps to `[above]` rows.

Analyze selected TypeScript files locally without executing them. Read original files when opening source. Preserve saved analysis and assume files remain unchanged while browsing.
