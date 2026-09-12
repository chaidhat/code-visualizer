import fs from "node:fs";
import path from "node:path";
import type { FileEntry } from "../../shared/graph";
export const MAX_FILE = 2 * 1024 * 1024;
export const excluded = new Set([
  ".git",
  ".ssh",
  ".aws",
  ".npm",
  ".pnpm-store",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".turbo",
  ".venv",
  "vendor",
]);
export const sensitive = (name: string) =>
  /^\.env|\.(pem|key|p12|pfx|keystore)$/i.test(name) ||
  /^(id_rsa|id_ed25519|id_ecdsa|id_dsa|credentials|\.npmrc|\.netrc)$/i.test(
    name,
  );
export function contained(root: string, target: string) {
  const rel = path.relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
  );
}
export function discover(root: string, progress: (message: string) => void) {
  root = fs.realpathSync(root);
  const files: FileEntry[] = [],
    configs: string[] = [],
    diagnostics: string[] = [];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  const seen = new Set<string>();
  let total = 0;
  function visit(dir: string, depth: number) {
    if (depth > 40) {
      skip("Folder depth limit");
      return;
    }
    let actual: string;
    try {
      actual = fs.realpathSync(dir);
    } catch {
      diagnostics.push("A folder could not be read.");
      return;
    }
    if (!contained(root, actual)) {
      skip("Link outside selected folder");
      return;
    }
    if (seen.has(actual)) {
      skip("Repeated folder or link cycle");
      return;
    }
    seen.add(actual);
    let entries: fs.Dirent[];
    try {
      entries = fs
        .readdirSync(actual, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      diagnostics.push(`Unreadable folder: ${path.relative(root, dir)}`);
      return;
    }
    for (const entry of entries) {
      if (excluded.has(entry.name) || sensitive(entry.name)) {
        skip("Excluded or private");
        continue;
      }
      if (files.length >= 10000 || total > 128 * 1024 * 1024) {
        skip("Project size limit");
        continue;
      }
      if (
        /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|mp4|mp3|woff2?|ttf|sqlite|db|exe|dll|so)$/i.test(
          entry.name,
        )
      ) {
        skip("Binary file");
        continue;
      }
      const full = path.join(actual, entry.name);
      try {
        if (entry.isSymbolicLink()) {
          skip("Symbolic link");
          continue;
        }
        if (entry.isDirectory()) {
          visit(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) {
          skip("Special file");
          continue;
        }
        const stat = fs.statSync(full);
        const relative = path.relative(root, full);
        if (stat.size > MAX_FILE) {
          skip("File size limit");
          files.push({
            id: relative,
            path: relative,
            supported: false,
            reason: "File exceeds 2 MiB",
          });
          continue;
        }
        if (entry.name === "tsconfig.json" || entry.name === "jsconfig.json")
          configs.push(full);
        const supported = /\.[cm]?[jt]sx?$/.test(entry.name);
        files.push({
          id: relative,
          path: relative,
          supported,
          ...(!supported && { reason: "Unsupported file type" }),
        });
        if (supported) total += stat.size;
      } catch {
        diagnostics.push(`Unreadable entry: ${path.relative(root, full)}`);
      }
    }
    progress(`Discovered ${files.length} files`);
  }
  visit(root, 0);
  return { files, configs, diagnostics, skipped };
}
