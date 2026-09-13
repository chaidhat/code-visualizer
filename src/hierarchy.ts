import type { Snapshot } from "./model.js";
import { label, safeText, type Row } from "./display.js";

const MAX_DEPTH = 10;

/** Discover callers and callees breadth first, then display their call tree. */
export function fileHierarchy(
  snapshot: Snapshot,
  file: string,
  focus?: string,
): Row[] {
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const connection of snapshot.connections) {
    if (
      connection.status !== "resolved" ||
      !connection.to ||
      !snapshot.declarations.has(connection.from) ||
      !snapshot.declarations.has(connection.to)
    )
      continue;
    const targets = outgoing.get(connection.from) ?? new Set<string>();
    targets.add(connection.to);
    outgoing.set(connection.from, targets);
    const callers = incoming.get(connection.to) ?? new Set<string>();
    callers.add(connection.from);
    incoming.set(connection.to, callers);
  }
  const seeds = [...snapshot.declarations.values()]
    .filter((declaration) =>
      focus !== undefined
        ? declaration.id === focus
        : declaration.file === file,
    )
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .map((declaration) => declaration.id);
  if (!seeds.length) return [{ text: "(no declarations)" }];

  const ancestors = new Map(seeds.map((id) => [id, 0]));
  const queue = [...seeds];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    const depth = ancestors.get(id)!;
    if (depth === MAX_DEPTH) continue;
    for (const caller of incoming.get(id) ?? []) {
      if (ancestors.has(caller)) continue;
      ancestors.set(caller, depth + 1);
      queue.push(caller);
    }
  }
  const roots = queue.filter(
    (id) => !incoming.get(id)?.size || ancestors.get(id) === MAX_DEPTH,
  );
  // Cycles may have no outermost caller. Keep selected declarations reachable.
  const covered = new Set<string>();
  const cover = (root: string) => {
    const pending = [{ id: root, depth: 0 }];
    const visited = new Set([root]);
    for (let index = 0; index < pending.length; index++) {
      const { id, depth } = pending[index]!;
      covered.add(id);
      if (depth === MAX_DEPTH) continue;
      for (const target of outgoing.get(id) ?? []) {
        if (visited.has(target)) continue;
        visited.add(target);
        pending.push({ id: target, depth: depth + 1 });
      }
    }
  };
  for (const root of roots) cover(root);
  for (const seed of seeds) {
    if (covered.has(seed)) continue;
    // With no outermost caller, use connection order for a stable cycle entry.
    const root = [...outgoing.keys()].find(
      (id) => ancestors.has(id) && !covered.has(id),
    );
    if (root) {
      roots.push(root);
      cover(root);
    }
    if (!covered.has(seed)) {
      roots.push(seed);
      cover(seed);
    }
  }

  const rows: Row[] = [];
  const printed = new Set<string>();
  const expanded = new Map<string, number>();
  const expansionKey = (id: string, belowTarget: boolean) =>
    JSON.stringify([id, belowTarget]);
  const path = new Set<string>();
  const print = (
    id: string,
    depth: number,
    belowTarget = focus === undefined,
  ) => {
    belowTarget = belowTarget || id === focus;
    const declaration = snapshot.declarations.get(id)!;
    const children = [...(outgoing.get(id) ?? [])].filter(
      (child) => belowTarget || ancestors.has(child),
    );
    const key = expansionKey(id, belowTarget);
    const marker = path.has(id)
      ? " [loop]"
      : expanded.has(key)
        ? " [above]"
        : depth === MAX_DEPTH && children.length
          ? " [depth limit]"
          : "";
    const name = safeText(
      `${"    ".repeat(depth)}${depth ? "-> " : ""}${label(declaration)}${marker}`,
    );
    const text = safeText(`${name}\t${declaration.file}:${declaration.line}`);
    printed.add(id);
    rows.push({
      text,
      name,
      pathText: text.slice(name.length),
      bold: declaration.id === focus,
      target: id,
      aboveRow: marker === " [above]" ? expanded.get(key) : undefined,
    });
    if (marker) return;
    expanded.set(key, rows.length - 1);
    path.add(id);
    for (const child of children) print(child, depth + 1, belowTarget);
    path.delete(id);
  };
  for (const root of roots) print(root, 0);
  // A long first branch must not hide a selected declaration behind the limit.
  for (const seed of seeds) {
    if (!printed.has(seed)) print(seed, 0);
  }
  return rows;
}
