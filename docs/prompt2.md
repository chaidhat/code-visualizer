# Current behavior

Run `npx cvis <path/file> <name>` to open the hierarchy for an exact function or object name. Both arguments are required. Omitted or empty names reject the command before analysis. Unknown or duplicate names print a message.

Only hierarchy and source views are available. There is no file list, file expansion, or list search. Use arrows or `j` and `k` to move, `l` or Enter to read source, and `h` or Escape to return. Back from hierarchy stays there. Keep scrolling, source reference colors, focused hierarchy branches, and jumps to `[aforementioned]` rows.

Analyze selected TypeScript files locally without executing them. Read original files when opening source. Preserve saved analysis and assume files remain unchanged while browsing.

Press `y` on a highlighted item to toggle acceptance, or while reading its source to toggle that item. Accepted names appear green throughout the hierarchy. The original row for a selected repeated reference is highlighted blue. Acceptance is saved under `~/.cvis/accepted/` as SHA-256 hashes, without source copies. It survives restarts and different starting names or selected folders when the absolute file location, containing names, and exact declaration code match. Changes inside the declaration, including whitespace and comments, make it unaccepted. Changes outside it do not. Ambiguous names within the same containing scope and File initialization cannot be accepted.
