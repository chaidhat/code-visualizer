# Current behavior

Run `npx cvis <path/file> <name>` to open the hierarchy for an exact function or object name. Both arguments are required. Omitted or empty names reject the command before analysis. Unknown or duplicate names print a message.

Only hierarchy and source views are available. There is no file list, file expansion, or list search. Use arrows or `j` and `k` to move, `l` or Enter to read source, and `h` or Escape to return. Back from hierarchy stays there. Keep scrolling, source reference colors, focused hierarchy branches, and jumps to `[aforementioned]` rows.

Analyze selected TypeScript files locally without executing them. Read original files when opening source. Preserve saved analysis and assume files remain unchanged while browsing.

Press `y` on a highlighted item to toggle acceptance, or while reading its source to toggle that item. Accepted names appear green throughout the hierarchy. The original row for a selected repeated reference is highlighted blue. Acceptance is saved under `~/.cvis/accepted/` as SHA-256 hashes, without source copies. It survives restarts and different starting names or selected folders when the absolute file location, containing names, and exact declaration code match. Changes inside the declaration, including whitespace and comments, make it unaccepted. Changes outside it do not. Ambiguous names within the same containing scope and File initialization cannot be accepted.

Opening source jumps to the first mention of a direct child. Child mentions have a grey background, with the current mention blue. Press `n` for the next mention and `N` for the previous mention, in source order, including repeated mentions on the same line. Navigation stops at the first and last mention. Declarations without child mentions open at the beginning.

Only objects and functions present in the current hierarchy receive special source highlighting. References hidden by the focused hierarchy or its depth limit keep normal code colors and are excluded from child navigation.

In the hierarchy, Cmd+C copies the selected row’s absolute file path to the clipboard and reports success or failure. It keeps the viewer open. Ctrl+C cancels and quits in every view. Cmd+C requires the terminal to forward the shortcut using enhanced keyboard input or a mapping to `\x1b[99;9u`.

Pass `--json` to print one structured result to standard output without styling, progress, or interaction. Redirected output is automatically JSON. Remove `--plaintext` and `--plain`. Include only the rows shown in the text hierarchy, in the same order, with names, kinds, file locations, and stop markers. Nest descendants under a `child` array on each item, using an empty array for leaves and stopped branches. Do not include separate connections, scope metadata, or warnings. Unknown names, ambiguous names, and errors also produce JSON results. Help and version remain ordinary text.
