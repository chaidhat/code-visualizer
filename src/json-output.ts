import { resolve } from "node:path";
import { findDeclaration } from "./find-declaration.js";
import { fileHierarchy } from "./hierarchy.js";
import type { Declaration, Snapshot } from "./model.js";

/** Export the same focused hierarchy as the viewer, without terminal text. */
export function jsonHierarchy(snapshot: Snapshot, name: string) {
  const location = (declaration: Declaration) => ({
    name: declaration.name,
    kind: declaration.kind,
    file: declaration.file,
    line: declaration.line,
    path: resolve(snapshot.root, declaration.file),
  });
  const common = {
    version: 1,
    root: snapshot.root,
    query: name,
  };
  const match = findDeclaration(snapshot, name);
  if (match.message !== undefined) {
    return {
      ...common,
      status: match.matches.length ? "ambiguous" : "not_found",
      message: match.message,
      matches: match.matches.map(location),
    };
  }
  const rows = fileHierarchy(
    snapshot,
    match.declaration.file,
    match.declaration.id,
  );
  interface Node {
    index: number;
    name: string;
    kind: Declaration["kind"];
    file: string;
    line: number;
    path: string;
    stopReason: (typeof rows)[number]["stopReason"] | null;
    originalRow: number | null;
    child: Node[];
  }
  const hierarchy: Node[] = [];
  const parents: Node[] = [];
  for (const [index, row] of rows.entries()) {
    const depth = row.depth ?? 0;
    const node: Node = {
      index,
      ...location(snapshot.declarations.get(row.target!)!),
      stopReason: row.stopReason ?? null,
      originalRow: row.aboveRow ?? null,
      child: [],
    };
    if (depth === 0) hierarchy.push(node);
    else parents[depth - 1].child.push(node);
    parents[depth] = node;
    parents.length = depth + 1;
  }
  return { ...common, status: "ok", hierarchy };
}
