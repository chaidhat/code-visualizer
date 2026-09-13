import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Declaration, Snapshot } from "./model.js";

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/** Store only identity hashes and code hashes, never source copies. */
export class Acceptance {
  readonly accepted = new Set<string>();
  warning?: string;
  private readonly keys = new Map<string, string>();

  constructor(
    private readonly snapshot: Snapshot,
    private readonly directory = join(homedir(), ".cvis", "accepted"),
  ) {
    const groups = new Map<string, string[]>();
    for (const declaration of snapshot.declarations.values()) {
      if (declaration.kind === "initialization") continue;
      const scope: string[][] = [];
      let current: Declaration | undefined = declaration;
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        scope.unshift([current.kind, current.name]);
        current = current.parent
          ? snapshot.declarations.get(current.parent)
          : undefined;
      }
      const key = sha256(
        JSON.stringify([resolve(snapshot.root, declaration.file), scope]),
      );
      groups.set(key, [...(groups.get(key) ?? []), declaration.id]);
    }
    for (const [key, ids] of groups) {
      // Ambiguous declarations must not inherit one another's acceptance.
      if (ids.length !== 1) continue;
      const id = ids[0]!;
      this.keys.set(id, key);
      try {
        const saved = readFileSync(join(directory, `${key}.sha256`), "utf8");
        if (!/^[a-f0-9]{64}$/.test(saved))
          throw new Error("Invalid saved hash");
        if (saved === this.codeHash(id)) this.accepted.add(id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          this.warning =
            "Could not read saved acceptance. Affected items remain unaccepted.";
      }
    }
  }

  private codeHash(id: string): string {
    const declaration = this.snapshot.declarations.get(id)!;
    const path = resolve(this.snapshot.root, declaration.file);
    const source = readFileSync(path, "utf8");
    if (
      declaration.start < 0 ||
      declaration.end <= declaration.start ||
      declaration.end > source.length
    )
      throw new Error("Source changed. Restart after edits.");
    return sha256(source.slice(declaration.start, declaration.end));
  }

  toggle(id: string): boolean {
    const key = this.keys.get(id);
    if (!key)
      throw new Error(
        "This item cannot be accepted because its name is ambiguous or it is file initialization.",
      );
    const file = join(this.directory, `${key}.sha256`);
    if (this.accepted.has(id)) {
      rmSync(file, { force: true });
      this.accepted.delete(id);
      return false;
    }
    const digest = this.codeHash(id);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `.write-${randomUUID()}`);
    try {
      writeFileSync(temporary, digest, { mode: 0o600, flag: "wx" });
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
    this.accepted.add(id);
    return true;
  }
}
