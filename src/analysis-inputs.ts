import { createHash } from "node:crypto";
import ts from "typescript";
import { statSync } from "node:fs";

export type InputMethod =
  | "fileSize"
  | "readFile"
  | "fileExists"
  | "directoryExists"
  | "getDirectories"
  | "realpath";
export interface AnalysisInput {
  method: InputMethod;
  path: string;
  value: string;
}

export const checksum = (text: string | Uint8Array): string =>
  createHash("sha256").update(text).digest("hex");

function fingerprint(method: InputMethod, value: unknown): string {
  return method === "readFile" && typeof value === "string"
    ? checksum(value)
    : JSON.stringify(value ?? null);
}

/** Track both successful reads and failed lookups, including imports outside the selection. */
export class AnalysisInputs {
  private inputs = new Map<string, AnalysisInput>();
  stable = true;

  private record<T>(method: InputMethod, path: string, value: T): T {
    const key = JSON.stringify([method, path]);
    const observation = { method, path, value: fingerprint(method, value) };
    const previous = this.inputs.get(key);
    if (previous && previous.value !== observation.value) this.stable = false;
    this.inputs.set(key, observation);
    return value;
  }

  readonly system = {
    readFile: (path: string) =>
      this.record("readFile", path, ts.sys.readFile(path)),
    fileExists: (path: string) =>
      this.record("fileExists", path, ts.sys.fileExists(path)),
    directoryExists: (path: string) =>
      this.record("directoryExists", path, ts.sys.directoryExists(path)),
    getDirectories: (path: string) =>
      this.record("getDirectories", path, ts.sys.getDirectories(path).sort()),
    realpath: (path: string) =>
      this.record("realpath", path, ts.sys.realpath?.(path) ?? path),
  };

  fileSize(path: string, size: number): void {
    this.record("fileSize", path, size);
  }

  entries(): AnalysisInput[] {
    return [...this.inputs.values()];
  }
}

export function changedInputs(inputs: AnalysisInput[]): AnalysisInput[] {
  return inputs.filter(({ method, path, value }) => {
    try {
      if (method === "readFile" && statSync(path).size > 2 * 1024 * 1024)
        return true;
      const current =
        method === "fileSize"
          ? statSync(path).size
          : method === "realpath"
            ? (ts.sys.realpath?.(path) ?? path)
            : method === "getDirectories"
              ? ts.sys.getDirectories(path).sort()
              : ts.sys[method](path);
      return fingerprint(method, current) !== value;
    } catch {
      return true;
    }
  });
}

export function inputsUnchanged(inputs: AnalysisInput[]): boolean {
  return changedInputs(inputs).length === 0;
}
