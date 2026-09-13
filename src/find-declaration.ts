import type { Declaration, Snapshot } from "./model.js";
import { safeText } from "./display.js";

export function findDeclaration(
  snapshot: Snapshot,
  name: string,
):
  | { declaration: Declaration; message?: never }
  | { declaration?: never; message: string } {
  const matches = [...snapshot.declarations.values()].filter(
    (item) => item.kind !== "initialization" && item.name === name,
  );
  if (matches.length === 1) return { declaration: matches[0]! };
  return {
    message: matches.length
      ? `Multiple declarations named "${safeText(name)}" found:\n${matches.map((item) => `  ${safeText(item.file)}:${item.line}`).join("\n")}`
      : `No function or object named "${safeText(name)}" found.`,
  };
}
