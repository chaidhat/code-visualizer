import { readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";

const testFolders = new Set(["__tests__", "test"]);

const excluded = new Set([
  "node_modules",
  ...testFolders,
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".turbo",
]);
export const isTypeScript = (file: string): boolean =>
  /\.(?:ts|tsx|mts|cts)$/.test(file) && !/\.d\.(?:ts|mts|cts)$/.test(file);

export function discover(input: string): {
  root: string;
  files: string[];
  warnings: string[];
} {
  const target = realpathSync(input);
  const info = statSync(target);
  if (!info.isDirectory() && (!info.isFile() || !isTypeScript(target))) {
    throw new Error(
      "Choose a TypeScript file or a folder. Declaration-only files are excluded.",
    );
  }
  const root = info.isDirectory() ? target : dirname(target);
  const files: string[] = [];
  const warnings: string[] = [];
  if (target.split(sep).some((part) => testFolders.has(part))) {
    warnings.push("Files inside __tests__ or test folders are excluded.");
    return { root, files, warnings };
  }
  let bytes = 0;
  let links = 0;
  function add(file: string) {
    const size = statSync(file).size;
    if (size > 2 * 1024 * 1024) {
      warnings.push(`Skipped file larger than 2 MiB: ${file}`);
      return;
    }
    bytes += size;
    if (files.length >= 10000 || bytes > 128 * 1024 * 1024) {
      throw new Error(
        "Project exceeds the limit of 10,000 files or 128 MiB. Choose a smaller folder.",
      );
    }
    files.push(file);
  }
  function walk(folder: string, depth: number) {
    if (depth > 40) {
      warnings.push(`Skipped folder deeper than 40 levels: ${folder}`);
      return;
    }
    for (const item of readdirSync(folder, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = join(folder, item.name);
      if (item.isSymbolicLink()) {
        links++;
        continue;
      }
      if (
        item.isDirectory() &&
        !excluded.has(item.name) &&
        !item.name.startsWith(".")
      )
        walk(path, depth + 1);
      else if (item.isFile() && isTypeScript(item.name)) add(path);
    }
  }
  if (info.isDirectory()) walk(target, 0);
  else add(target);
  if (links) warnings.push(`Skipped ${links} symbolic links during discovery.`);
  return { root, files, warnings };
}
