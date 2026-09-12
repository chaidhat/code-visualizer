import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { contained, MAX_FILE, sensitive, excluded } from "./discover";
export function createContexts(
  root: string,
  files: string[],
  configs: string[],
  diagnostics: string[],
) {
  const libRoot = path.dirname(ts.getDefaultLibFilePath({}));
  let bytes = 0;
  const cache = new Map<string, string | undefined>();
  const allowed = (file: string) => {
    try {
      const real = fs.realpathSync(file);
      if (sensitive(path.basename(real))) return false;
      if (real.split(path.sep).includes("node_modules"))
        return /(\.d\.[cm]?ts|\.json)$/.test(real);
      if (contained(root, real))
        return !path
          .relative(root, real)
          .split(path.sep)
          .some((p) => excluded.has(p) && p !== "node_modules");
      if (contained(libRoot, real)) return /\.d\.ts$/.test(real);
      // Type resolution outside the root is limited to dependency declarations and JSON.
      return (
        real.split(path.sep).includes("node_modules") &&
        /(\.d\.[cm]?ts|\.json)$/.test(real)
      );
    } catch {
      return false;
    }
  };
  const readFile = (file: string) => {
    if (cache.has(file)) return cache.get(file);
    if (!allowed(file)) return undefined;
    try {
      const size = fs.statSync(file).size;
      if (size > MAX_FILE || bytes + size > 256 * 1024 * 1024) {
        diagnostics.push(
          "Analysis read limit reached. Some targets may be unresolved.",
        );
        return undefined;
      }
      const fd = fs.openSync(
        fs.realpathSync(file),
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      let text: string;
      try {
        if (!allowed(file) || !fs.fstatSync(fd).isFile()) return undefined;
        const buffer = Buffer.alloc(MAX_FILE + 1);
        const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (count > MAX_FILE) {
          diagnostics.push("A source file grew beyond the read limit.");
          return undefined;
        }
        text = buffer.subarray(0, count).toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
      bytes += size;
      cache.set(file, text);
      return text;
    } catch {
      return undefined;
    }
  };
  const fileExists = (file: string) => allowed(file) && ts.sys.fileExists(file);
  const base: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
  };
  const definitions: { names: string[]; options: ts.CompilerOptions }[] = [];
  const covered = new Set<string>();
  for (const config of configs.slice(0, 100)) {
    const parsed = ts.readConfigFile(config, readFile);
    if (parsed.error) {
      diagnostics.push(`Could not parse ${path.relative(root, config)}`);
      continue;
    }
    const result = ts.parseJsonConfigFileContent(
      parsed.config,
      {
        ...ts.sys,
        readFile,
        fileExists,
        readDirectory: (dir, extensions, excludes, includes, depth) =>
          contained(root, path.resolve(dir))
            ? ts.sys
                .readDirectory(
                  dir,
                  extensions,
                  excludes,
                  includes,
                  Math.min(depth ?? 40, 40),
                )
                .filter((f) => files.includes(f))
            : [],
      },
      path.dirname(config),
      { noEmit: true, allowJs: true },
      config,
    );
    for (const error of result.errors)
      diagnostics.push(
        `${path.relative(root, config)}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
      );
    for (const ref of result.projectReferences ?? [])
      if (!contained(root, ref.path))
        diagnostics.push(
          "A project reference is outside the selected folder and was not analyzed.",
        );
    const names = result.fileNames.filter((f) => files.includes(f));
    names.forEach((f) => covered.add(f));
    if (names.length)
      definitions.push({
        names,
        options: { ...base, ...result.options, plugins: [], noEmit: true },
      });
  }
  if (configs.length > 100)
    diagnostics.push(
      "Configuration count limit reached. Remaining files use fallback settings.",
    );
  const fallback = files.filter((f) => !covered.has(f));
  if (fallback.length) {
    definitions.push({ names: fallback, options: base });
    diagnostics.push(
      `${fallback.length} files use fallback TypeScript/JavaScript settings.`,
    );
  }
  return definitions.map(({ names, options }) => {
    const service = ts.createLanguageService({
      getScriptFileNames: () => names,
      getScriptVersion: () => "1",
      getScriptSnapshot: (file) => {
        const text = readFile(file);
        return text === undefined
          ? undefined
          : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => root,
      getCompilationSettings: () => options,
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      fileExists,
      readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      realpath: ts.sys.realpath,
    });
    return { service, names, program: service.getProgram()! };
  });
}
