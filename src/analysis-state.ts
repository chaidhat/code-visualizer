import type { Snapshot } from "./model.js";

export interface AnalysisState {
  readBudgetExceeded: boolean;
  dependencies: Map<string, Set<string>>;
  globalFiles: Set<string>;
  fileWarnings: Map<string, Set<string>>;
}

export interface AnalysisReuse {
  snapshot: Snapshot;
  affected: Set<string>;
}

export function emptyAnalysisState(): AnalysisState {
  return {
    readBudgetExceeded: false,
    dependencies: new Map(),
    globalFiles: new Set(),
    fileWarnings: new Map(),
  };
}

/** Include callers and re-exporters transitively, including cycles. */
export function affectedFiles(
  changed: Set<string>,
  state: AnalysisState,
): Set<string> {
  const affected = new Set(changed);
  let added = true;
  while (added) {
    added = false;
    for (const [file, dependencies] of state.dependencies) {
      if (
        !affected.has(file) &&
        [...dependencies].some((dependency) => affected.has(dependency))
      ) {
        affected.add(file);
        added = true;
      }
    }
  }
  return affected;
}
