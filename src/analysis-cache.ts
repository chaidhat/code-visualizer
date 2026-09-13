import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { deserialize, serialize } from "node:v8";
import ts from "typescript";
import { z } from "zod";
import { analyze } from "./analyze.js";
import {
  AnalysisInputs,
  checksum,
  inputsUnchanged,
  changedInputs,
} from "./analysis-inputs.js";
import {
  affectedFiles,
  emptyAnalysisState,
  type AnalysisReuse,
} from "./analysis-state.js";
import { discover } from "./discover.js";
import type { ReadProgress, Snapshot } from "./model.js";

const position = z.number().int().nonnegative();
const snapshotSchema = z.object({
  root: z.string(),
  files: z.array(z.string()),
  warnings: z.array(z.string()),
  declarations: z.map(
    z.string(),
    z.object({
      id: z.string(),
      file: z.string(),
      name: z.string(),
      kind: z.enum(["function", "class", "object", "type", "initialization"]),
      start: position,
      end: position,
      line: position,
      parent: z.string().optional(),
    }),
  ),
  connections: z.array(
    z.object({
      from: z.string(),
      to: z.string().optional(),
      label: z.string(),
      kind: z.enum(["call", "reference"]),
      status: z.enum(["resolved", "external", "unresolved"]),
      line: position,
    }),
  ),
  references: z
    .map(z.string(), z.array(z.object({ start: position, end: position })))
    .optional(),
});
const cacheSchema = z.object({
  version: z.literal(2),
  state: z.object({
    readBudgetExceeded: z.boolean(),
    dependencies: z.map(z.string(), z.set(z.string())),
    globalFiles: z.set(z.string()),
    fileWarnings: z.map(z.string(), z.set(z.string())),
  }),
  engine: z.string(),
  selection: z.string(),
  inputs: z.array(
    z.object({
      method: z.enum([
        "readFile",
        "fileSize",
        "fileExists",
        "directoryExists",
        "getDirectories",
        "realpath",
      ]),
      path: z.string(),
      value: z.string(),
    }),
  ),
  snapshot: snapshotSchema,
});
const maxCacheBytes = 128 * 1024 * 1024;

function engineKey(): string {
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  return checksum(
    JSON.stringify([
      1,
      ts.version,
      process.version,
      process.platform,
      process.cwd(),
      ...[
        "analyze",
        "discover",
        "analysis-inputs",
        "analysis-state",
        "analysis-cache",
      ].map((name) =>
        checksum(
          readFileSync(new URL(`./${name}${extension}`, import.meta.url)),
        ),
      ),
    ]),
  );
}

/** Reuse the complete result only when every observed analysis input still matches. */
export function cachedAnalysis(
  input: string,
  onProgress?: (progress: ReadProgress) => void,
  directory = join(homedir(), ".cvis", "analysis"),
): Snapshot {
  const target = realpathSync(input);
  const selection = JSON.stringify(discover(target));
  const engine = engineKey();
  const file = join(directory, `${checksum(target)}.bin`);
  let cacheWarning: string | undefined;
  let state = emptyAnalysisState();
  let reuse: AnalysisReuse | undefined;
  let previousInputs: ReturnType<AnalysisInputs["entries"]> = [];
  try {
    if (statSync(file).size > maxCacheBytes)
      throw new Error("Saved analysis exceeds the size limit.");
    const bytes = readFileSync(file);
    // A digest detects partial writes and damage before decoding the saved result.
    if (
      bytes.length < 64 ||
      checksum(bytes.subarray(64)) !== bytes.subarray(0, 64).toString()
    )
      throw new Error("Saved analysis checksum does not match.");
    const saved = cacheSchema.parse(deserialize(bytes.subarray(64)));
    if (saved.engine === engine && saved.selection === selection) {
      const changed = changedInputs(saved.inputs);
      if (!changed.length) {
        onProgress?.({
          read: saved.snapshot.files.length,
          total: saved.snapshot.files.length,
        });
        return {
          ...saved.snapshot,
          analysis: {
            analyzedFiles: 0,
            reusedFiles: saved.snapshot.files.length,
          },
        };
      }
      const selected = new Set(
        saved.snapshot.files.map((file) => resolve(saved.snapshot.root, file)),
      );
      const changedFiles = new Set(changed.map((entry) => resolve(entry.path)));
      // Shared settings, resolution changes, and global declarations require a full rebuild.
      if (
        !saved.state.readBudgetExceeded &&
        changed.every(
          (entry) =>
            (entry.method === "readFile" || entry.method === "fileSize") &&
            selected.has(resolve(entry.path)),
        ) &&
        ![...changedFiles].some((file) => saved.state.globalFiles.has(file))
      ) {
        state = saved.state;
        reuse = {
          snapshot: saved.snapshot,
          affected: affectedFiles(changedFiles, state),
        };
        previousInputs = saved.inputs;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      cacheWarning = "Could not reuse saved analysis. Reanalyzed the project.";
  }

  const previousGlobals = new Set(state.globalFiles);
  const previousDependencies = new Map(state.dependencies);
  if (reuse) for (const file of reuse.affected) state.dependencies.delete(file);
  let inputs = new AnalysisInputs();
  let snapshot = analyze(target, onProgress, inputs, state, reuse);
  // A changed file can introduce a new global declaration or cross-file mutation.
  if (
    reuse &&
    (state.readBudgetExceeded ||
      [...state.globalFiles].some((file) => !previousGlobals.has(file)) ||
      [...reuse.affected].some(
        (file) =>
          state.globalFiles.has(file) ||
          JSON.stringify([...(state.dependencies.get(file) ?? [])].sort()) !==
            JSON.stringify([...(previousDependencies.get(file) ?? [])].sort()),
      ))
  ) {
    reuse = undefined;
    previousInputs = [];
    state = emptyAnalysisState();
    inputs = new AnalysisInputs();
    snapshot = analyze(target, onProgress, inputs, state);
  }
  const mergedInputs = new Map(
    previousInputs.map((entry) => [
      JSON.stringify([entry.method, entry.path]),
      entry,
    ]),
  );
  for (const entry of inputs.entries())
    mergedInputs.set(JSON.stringify([entry.method, entry.path]), entry);
  const observations = [...mergedInputs.values()];
  let temporary: string | undefined;
  try {
    if (
      !inputs.stable ||
      selection !== JSON.stringify(discover(target)) ||
      !inputsUnchanged(observations)
    ) {
      snapshot.warnings.push(
        "Files changed during analysis. Results were not saved. Restart to refresh.",
      );
    } else {
      const payload = serialize({
        version: 2,
        state,
        engine,
        selection,
        inputs: observations,
        snapshot,
      });
      if (payload.length + 64 > maxCacheBytes)
        throw new Error("Saved analysis exceeds the size limit.");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      temporary = mkdtempSync(join(directory, ".write-"));
      const pending = join(temporary, "analysis.bin");
      writeFileSync(
        pending,
        Buffer.concat([Buffer.from(checksum(payload)), payload]),
        { mode: 0o600 },
      );
      renameSync(pending, file);
    }
  } catch {
    snapshot.warnings.push(
      "Could not save analysis. Results are available, but the next run may reanalyze.",
    );
  } finally {
    if (temporary) {
      try {
        rmSync(temporary, { recursive: true, force: true });
      } catch {
        snapshot.warnings.push(
          "Could not remove temporary analysis data from the cache directory.",
        );
      }
    }
  }
  if (cacheWarning) snapshot.warnings.push(cacheWarning);
  const analyzedFiles = reuse
    ? snapshot.files.filter((file) =>
        reuse.affected.has(resolve(snapshot.root, file)),
      ).length
    : snapshot.files.length;
  snapshot.analysis = {
    analyzedFiles,
    reusedFiles: snapshot.files.length - analyzedFiles,
  };
  return snapshot;
}
