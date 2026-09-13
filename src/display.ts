import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import stringWidth from "string-width";
import type { Declaration, Snapshot } from "./model.js";

export interface Row {
  text: string;
  name?: string;
  pathText?: string;
  bold?: boolean;
  aboveRow?: number;
  highlights?: { start: number; end: number }[];
  target?: string;
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

export function sourceRows(snapshot: Snapshot, id: string): Row[] {
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
  const lines = source.slice(declaration.start, declaration.end).split(/\r?\n/);
  const width = String(declaration.line + lines.length - 1).length;
  const references = (snapshot.references?.get(declaration.file) ?? []).filter(
    (span) => span.start >= declaration.start && span.end <= declaration.end,
  );
  let offset = declaration.start;
  return lines.map((line, index) => {
    const prefix = `${String(declaration.line + index).padStart(width)}  `;
    const highlights = references
      .filter(
        (span) => span.start >= offset && span.end <= offset + line.length,
      )
      .map((span) => ({
        start:
          prefix.length + safeText(line.slice(0, span.start - offset)).length,
        end: prefix.length + safeText(line.slice(0, span.end - offset)).length,
      }));
    offset +=
      line.length +
      (source.slice(offset + line.length, offset + line.length + 2) === "\r\n"
        ? 2
        : 1);
    return { text: prefix + safeText(line), highlights };
  });
}

/** Preserve reference colors when the source view scrolls sideways. */
export function sourceSegments(
  row: Row,
  horizontal: number,
): { text: string; highlighted: boolean }[] {
  const segments: { text: string; highlighted: boolean }[] = [];
  let position = horizontal;
  for (const span of row.highlights ?? []) {
    if (span.end <= position) continue;
    if (span.start > position)
      segments.push({
        text: row.text.slice(position, span.start),
        highlighted: false,
      });
    segments.push({
      text: row.text.slice(Math.max(position, span.start), span.end),
      highlighted: true,
    });
    position = span.end;
  }
  if (position < row.text.length)
    segments.push({ text: row.text.slice(position), highlighted: false });
  return segments;
}
