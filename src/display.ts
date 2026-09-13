import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import stringWidth from "string-width";
import { syntaxSpans, type SyntaxSpan } from "./syntax.js";
import type { Declaration, Snapshot } from "./model.js";

export interface Row {
  text: string;
  name?: string;
  pathText?: string;
  bold?: boolean;
  aboveRow?: number;
  highlights?: { start: number; end: number }[];
  children?: { start: number; end: number }[];
  target?: string;
  syntax?: SyntaxSpan[];
}

// Source and filenames are untrusted terminal text. Never interpret their escape sequences.
export function safeText(text: string): string {
  const escaped = text
    .replace(
      /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    )
    .replace(/\n/g, "\\n");
  if (!escaped.includes("\t")) return escaped;
  // Expand to four-column tab stops before Ink measures or truncates the row.
  let column = 0;
  return escaped
    .split("\t")
    .map((part, index) => {
      const padding = index === 0 ? "" : " ".repeat(4 - (column % 4));
      column += padding.length + stringWidth(part);
      return padding + part;
    })
    .join("");
}

export function label(declaration: Declaration): string {
  return (
    declaration.name +
    (declaration.kind === "function"
      ? "()"
      : declaration.kind === "type"
        ? " [type]"
        : "")
  );
}

export function sourceRows(
  snapshot: Snapshot,
  id: string,
  visibleTargets?: ReadonlySet<string>,
): Row[] {
  const declaration = snapshot.declarations.get(id);
  if (!declaration) return [{ text: "Declaration unavailable." }];
  let source: string;
  try {
    source = readFileSync(resolve(snapshot.root, declaration.file), "utf8");
  } catch {
    return [
      {
        text: `Could not read source file: ${safeText(declaration.file)}. Check that it exists and is readable, then reopen it.`,
      },
    ];
  }
  const spans = syntaxSpans(source, declaration.file);
  let syntaxIndex = 0;
  const lines = source.slice(declaration.start, declaration.end).split(/\r?\n/);
  const width = String(declaration.line + lines.length - 1).length;
  const references = (snapshot.references?.get(declaration.file) ?? []).filter(
    (span) => span.start >= declaration.start && span.end <= declaration.end,
  );
  const childIds = new Set(
    snapshot.connections
      .filter(
        (edge) =>
          edge.from === id &&
          edge.status === "resolved" &&
          edge.to !== undefined &&
          snapshot.declarations.has(edge.to),
      )
      .map((edge) => edge.to),
  );
  let offset = declaration.start;
  return lines.map((line, index) => {
    const prefix = `${String(declaration.line + index).padStart(width)}  `;
    const lineReferences = references.filter(
      (span) =>
        span.start >= offset &&
        span.end <= offset + line.length &&
        span.to !== undefined &&
        (visibleTargets ?? childIds).has(span.to),
    );
    const displaySpan = (span: { start: number; end: number }) => ({
      start:
        prefix.length + safeText(line.slice(0, span.start - offset)).length,
      end: prefix.length + safeText(line.slice(0, span.end - offset)).length,
    });
    const children = lineReferences
      .filter((span) => span.from === id && childIds.has(span.to))
      .map(displaySpan);
    const highlights = lineReferences.map(displaySpan);
    const syntax: SyntaxSpan[] = [];
    while (syntaxIndex < spans.length && spans[syntaxIndex].end <= offset)
      syntaxIndex++;
    for (
      let i = syntaxIndex;
      i < spans.length && spans[i].start < offset + line.length;
      i++
    ) {
      const span = spans[i];
      syntax.push({
        start:
          prefix.length +
          safeText(line.slice(0, Math.max(0, span.start - offset))).length,
        end:
          prefix.length +
          safeText(line.slice(0, Math.min(line.length, span.end - offset)))
            .length,
        color: span.color,
      });
    }
    offset +=
      line.length +
      (source.slice(offset + line.length, offset + line.length + 2) === "\r\n"
        ? 2
        : 1);
    return { text: prefix + safeText(line), highlights, children, syntax };
  });
}

/** Preserve syntax colors and give resolved references priority while scrolling. */
export function sourceSegments(
  row: Row,
  horizontal: number,
): {
  text: string;
  highlighted: boolean;
  color?: string;
  child?: boolean;
  start?: number;
}[] {
  if (horizontal >= row.text.length) return [];
  const highlights = row.highlights ?? [];
  const syntax = row.syntax ?? [];
  const children = row.children ?? [];
  const boundaries = new Set([horizontal, row.text.length]);
  for (const span of [...highlights, ...syntax, ...children]) {
    if (span.start > horizontal) boundaries.add(span.start);
    if (span.end > horizontal) boundaries.add(span.end);
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const segments: {
    text: string;
    highlighted: boolean;
    color?: string;
    child?: boolean;
    start?: number;
  }[] = [];
  let highlightIndex = 0;
  let syntaxIndex = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    if (start >= row.text.length) break;
    while (
      highlightIndex < highlights.length &&
      highlights[highlightIndex].end <= start
    )
      highlightIndex++;
    while (syntaxIndex < syntax.length && syntax[syntaxIndex].end <= start)
      syntaxIndex++;
    const highlighted = highlights[highlightIndex]?.start <= start;
    const color =
      syntax[syntaxIndex]?.start <= start
        ? syntax[syntaxIndex].color
        : undefined;
    segments.push({
      text: row.text.slice(start, points[i + 1]),
      highlighted,
      start,
      child: children.some((span) => span.start <= start && start < span.end),
      ...(color ? { color } : {}),
    });
  }
  return segments;
}
