import ts from "typescript";
import {
  emptyAnalysisState,
  type AnalysisState,
  type AnalysisReuse,
} from "./analysis-state.js";
import type { AnalysisInputs } from "./analysis-inputs.js";
import { statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { discover } from "./discover.js";
import type {
  Connection,
  Declaration,
  Snapshot,
  ReadProgress,
} from "./model.js";

const message = (d: ts.Diagnostic): string => {
  const location =
    d.file && d.start !== undefined
      ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: `
      : "";
  return location + ts.flattenDiagnosticMessageText(d.messageText, "\n");
};

function functionNode(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function definition(
  node: ts.Node,
): { kind: Declaration["kind"]; name: string; span: ts.Node } | undefined {
  if (functionNode(node)) {
    const parent = node.parent;
    const name =
      node.name?.getText() ??
      (ts.isConstructorDeclaration(node)
        ? "constructor"
        : ts.isVariableDeclaration(parent) ||
            ts.isPropertyAssignment(parent) ||
            ts.isPropertyDeclaration(parent)
          ? parent.name.getText()
          : `callback at line ${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    const span =
      ts.isVariableDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent)
        ? parent
        : node;
    // A query inside procedure({ ... }) belongs to the surrounding route key.
    // Stop at other declarations so an unrelated outer key is never borrowed.
    if (
      name === "query" &&
      (ts.isPropertyAssignment(span) || ts.isMethodDeclaration(span)) &&
      ts.isObjectLiteralExpression(span.parent)
    ) {
      let container: ts.Node = span.parent.parent;
      while (
        ts.isCallExpression(container) ||
        ts.isParenthesizedExpression(container) ||
        ts.isAsExpression(container) ||
        ts.isSatisfiesExpression(container)
      ) {
        container = container.parent;
      }
      if (ts.isPropertyAssignment(container)) {
        return {
          kind: "function",
          name: `${container.name.getText()}: query`,
          span,
        };
      }
    }
    return { kind: "function", name, span };
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node))
    return {
      kind: "class",
      name:
        node.name?.getText() ??
        (ts.isVariableDeclaration(node.parent)
          ? node.parent.name.getText()
          : "default class"),
      span: ts.isVariableDeclaration(node.parent) ? node.parent : node,
    };
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
    return { kind: "type", name: node.name.text, span: node };
  if (
    (ts.isVariableDeclaration(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isPropertyDeclaration(node)) &&
    node.initializer &&
    (ts.isObjectLiteralExpression(node.initializer) ||
      ts.isNewExpression(node.initializer))
  )
    return { kind: "object", name: node.name.getText(), span: node };
  return undefined;
}

/** Creates one immutable snapshot. Never imports or executes the selected code. */
export function analyze(
  input: string,
  onProgress?: (progress: ReadProgress) => void,
  inputs?: AnalysisInputs,
  state: AnalysisState = emptyAnalysisState(),
  reuse?: AnalysisReuse,
): Snapshot {
  const system = inputs?.system ?? ts.sys;
  const discovered = discover(input);
  let read = 0;
  onProgress?.({ read, total: discovered.files.length });
  const result: Snapshot = {
    root: discovered.root,
    files: discovered.files.map((f) => relative(discovered.root, f)),
    declarations: new Map(),
    connections: [],
    warnings: [...discovered.warnings],
  };
  const refresh = (file: string) =>
    !reuse || reuse.affected.has(resolve(result.root, file));
  if (reuse) {
    const old = reuse.snapshot;
    result.declarations = new Map(
      [...old.declarations].filter(
        ([, declaration]) => !refresh(declaration.file),
      ),
    );
    result.connections = old.connections.filter((edge) => {
      const owner = old.declarations.get(edge.from);
      return owner && !refresh(owner.file);
    });
    result.references = new Map(
      [...(old.references ?? [])].filter(([file]) => !refresh(file)),
    );
    const outdatedWarnings = new Set(
      [...state.fileWarnings]
        .filter(([file]) => refresh(file))
        .flatMap(([, warnings]) => [...warnings]),
    );
    result.warnings.push(
      ...old.warnings.filter((warning) => !outdatedWarnings.has(warning)),
    );
    for (const file of state.fileWarnings.keys())
      if (refresh(file)) state.fileWarnings.delete(file);
  }
  if (!discovered.files.length) return result;
  const selected = new Set(discovered.files);
  const warningSet = new Set(result.warnings);
  const warn = (text: string, file?: string) => {
    warningSet.add(text);
    if (file) {
      const warnings = state.fileWarnings.get(file) ?? new Set<string>();
      warnings.add(text);
      state.fileWarnings.set(file, warnings);
    }
  };
  const reads = new Map<string, string | undefined>();
  let bytes = 0;
  const readFile = (file: string): string | undefined => {
    const key = resolve(file);
    if (reads.has(key)) return reads.get(key);
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      system.fileExists(file);
      reads.set(key, undefined);
      return undefined;
    }
    inputs?.fileSize(file, size);
    if (bytes + size > 256 * 1024 * 1024) state.readBudgetExceeded = true;
    if (size > 2 * 1024 * 1024 || bytes + size > 256 * 1024 * 1024) {
      warn(`Analysis read limit reached: ${file}`);
      reads.set(key, undefined);
      return undefined;
    }
    const text = system.readFile(file);
    if (text !== undefined) {
      size = Buffer.byteLength(text);
      if (bytes + size > 256 * 1024 * 1024) state.readBudgetExceeded = true;
      if (size > 2 * 1024 * 1024 || bytes + size > 256 * 1024 * 1024) {
        warn(`Analysis read limit reached: ${file}`);
        reads.set(key, undefined);
        return undefined;
      }
      bytes += size;
    }
    reads.set(key, text);
    if (text !== undefined && selected.has(key)) {
      read++;
      onProgress?.({ read, total: selected.size });
    }
    return text;
  };
  // Nearest settings are cached per directory. Separate projects keep their own aliases.
  const configByDirectory = new Map<string, string | undefined>();
  const groups = new Map<string, string[]>();
  for (const file of discovered.files) {
    const directory = dirname(file);
    if (!configByDirectory.has(directory))
      configByDirectory.set(
        directory,
        ts.findConfigFile(directory, system.fileExists),
      );
    const config = configByDirectory.get(directory) ?? "";
    const group = groups.get(config) ?? [];
    group.push(file);
    groups.set(config, group);
  }
  for (const [config, roots] of groups) {
    const rootSet = new Set(
      roots.filter((file) => refresh(relative(result.root, file))),
    );
    if (!rootSet.size) continue;
    let options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      allowJs: false,
      noEmit: true,
      skipLibCheck: true,
    };
    if (config) {
      const loaded = ts.readConfigFile(config, readFile);
      if (loaded.error) throw new Error(message(loaded.error));
      const parsed = ts.parseJsonConfigFileContent(
        loaded.config,
        { ...ts.sys, ...system, readFile, readDirectory: () => [] },
        dirname(config),
        undefined,
        config,
      );
      const errors = parsed.errors.filter((d) => d.code !== 18003);
      if (errors.length) throw new Error(errors.map(message).join("\n"));
      options = { ...options, ...parsed.options, noEmit: true, plugins: [] };
    } else
      warn(
        "No tsconfig.json found for some files. Using standard TypeScript import resolution.",
      );
    const host = ts.createCompilerHost(options, true);
    host.readFile = readFile;
    host.fileExists = system.fileExists;
    host.directoryExists = system.directoryExists;
    host.getDirectories = system.getDirectories;
    host.realpath = system.realpath;
    const moduleCache = ts.createModuleResolutionCache(
      dirname(config || roots[0]),
      host.getCanonicalFileName,
      options,
    );
    host.resolveModuleNameLiterals = (
      literals,
      containingFile,
      redirectedReference,
      compilerOptions,
      containingSourceFile,
    ) =>
      literals.map((literal) => {
        const resolved = ts.resolveModuleName(
          literal.text,
          containingFile,
          compilerOptions,
          host,
          moduleCache,
          redirectedReference,
          ts.getModeForUsageLocation(
            containingSourceFile,
            literal,
            compilerOptions,
          ),
        );
        if (resolved.resolvedModule) {
          const dependencies =
            state.dependencies.get(resolve(containingFile)) ??
            new Set<string>();
          dependencies.add(resolve(resolved.resolvedModule.resolvedFileName));
          state.dependencies.set(resolve(containingFile), dependencies);
        }
        return resolved;
      });
    const program = ts.createProgram({ rootNames: roots, options, host });
    for (const source of program.getSourceFiles()) {
      const path = resolve(source.fileName);
      for (const reference of source.referencedFiles)
        state.globalFiles.add(resolve(dirname(path), reference.fileName));
      if (
        !ts.isExternalModule(source) ||
        source.referencedFiles.length ||
        source.typeReferenceDirectives.length ||
        source.statements.some((statement) => ts.isModuleDeclaration(statement))
      )
        state.globalFiles.add(path);
    }
    const checker = program.getTypeChecker();
    for (const diagnostic of program.getOptionsDiagnostics())
      warn(message(diagnostic));
    const sources = [...rootSet]
      .map((f) => program.getSourceFile(f))
      .filter((f): f is ts.SourceFile => !!f);
    for (const file of rootSet)
      if (!program.getSourceFile(file))
        warn(`Could not analyze ${file}`, relative(result.root, file));
    const declarations = new Map<ts.Node, string>();
    const owners = new Map<ts.Node, string>();
    const foldedFunctions = new Set<ts.Node>();
    const idFor = (node: ts.Node): string =>
      `${relative(result.root, node.getSourceFile().fileName)}:${node.getStart()}`;
    // Include imported selected files for target lookup, but emit each file only in its own context.
    for (const source of program.getSourceFiles()) {
      if (!selected.has(resolve(source.fileName))) continue;
      const file = relative(result.root, source.fileName);
      const emit = rootSet.has(resolve(source.fileName));
      if (emit) {
        for (const diagnostic of program.getSyntacticDiagnostics(source))
          warn(message(diagnostic), file);
      }
      const initialId = `${file}:initialization`;
      const initial: Declaration = {
        id: initialId,
        file,
        name: "File initialization",
        kind: "initialization",
        start: 0,
        end: source.end,
        line: 1,
      };
      function visit(node: ts.Node, owner: string, parent?: string) {
        const entry = definition(node);
        let nextParent = parent;
        const fold =
          entry?.kind === "function" &&
          owner !== initialId &&
          (ts.isArrowFunction(node) ||
            ts.isFunctionExpression(node) ||
            ts.isFunctionDeclaration(node));
        if (entry && fold) {
          declarations.set(node, owner);
          declarations.set(entry.span, owner);
          foldedFunctions.add(node);
          foldedFunctions.add(entry.span);
        } else if (entry) {
          const id = idFor(node);
          const binding = entry.span;
          const span =
            ts.isVariableDeclaration(binding) &&
            ts.isVariableDeclarationList(binding.parent) &&
            binding.parent.declarations.length === 1 &&
            ts.isVariableStatement(binding.parent.parent)
              ? binding.parent.parent
              : binding;
          const declaration: Declaration = {
            id,
            file,
            name: entry.name,
            kind: entry.kind,
            start: span.getStart(),
            end: span.end,
            line:
              source.getLineAndCharacterOfPosition(span.getStart()).line + 1,
            parent,
          };
          declarations.set(node, id);
          if (entry.span !== node) declarations.set(entry.span, id);
          if (emit) result.declarations.set(id, declaration);
          nextParent = id;
          // A class/object is a container. Initializers are not calls by its methods.
          if (entry.kind === "function") owner = id;
        }
        owners.set(node, owner);
        ts.forEachChild(node, (child) => visit(child, owner, nextParent));
      }
      visit(source, initialId);
      if (emit) result.declarations.set(initialId, initial);
    }
    const symbolAt = (node: ts.Node): ts.Symbol | undefined => {
      const symbol = checker.getSymbolAtLocation(node);
      return symbol && symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    };
    const writes = new Set<ts.Symbol>();
    function trackWrites(node: ts.Node) {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        const symbol = symbolAt(node.left);
        if (symbol) {
          writes.add(symbol);
          if (
            symbol.declarations?.some(
              (declaration) =>
                declaration.getSourceFile() !== node.getSourceFile(),
            )
          )
            state.globalFiles.add(resolve(node.getSourceFile().fileName));
        }
      }
      ts.forEachChild(node, trackWrites);
    }
    for (const source of program.getSourceFiles())
      if (!source.isDeclarationFile) trackWrites(source);
    const targetFor = (
      symbol: ts.Symbol | undefined,
    ): { id?: string; external: boolean; folded?: boolean } => {
      const candidates = symbol?.declarations ?? [];
      // Prefer an implementation over an overload signature.
      const sorted = [...candidates].sort(
        (a, b) =>
          Number(functionNode(b) && !!b.body) -
          Number(functionNode(a) && !!a.body),
      );
      for (const declaration of sorted) {
        const id = declarations.get(declaration);
        if (id)
          return {
            id,
            external: false,
            folded: foldedFunctions.has(declaration),
          };
      }
      return {
        external: candidates.some(
          (d) => !selected.has(resolve(d.getSourceFile().fileName)),
        ),
      };
    };
    for (const source of sources) {
      const file = relative(result.root, source.fileName);
      function visit(node: ts.Node) {
        const owner = owners.get(node) ?? `${file}:initialization`;
        const line =
          source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          !checker.getSymbolAtLocation(node.moduleSpecifier)
        ) {
          warn(
            `Could not resolve import ${node.moduleSpecifier.getText(source)} in ${file}:${line}. Check project settings and installed dependencies.`,
            file,
          );
        }
        if (
          ts.isCallExpression(node) ||
          ts.isNewExpression(node) ||
          ts.isTaggedTemplateExpression(node)
        ) {
          const expression = ts.isTaggedTemplateExpression(node)
            ? node.tag
            : node.expression;
          const symbol = symbolAt(expression);
          const target = targetFor(symbol);
          const mutable = symbol && writes.has(symbol);
          if (!(target.folded && target.id === owner))
            result.connections.push({
              from: owner,
              to: mutable ? undefined : target.id,
              label: expression.getText(source),
              kind: "call",
              status: mutable
                ? "unresolved"
                : target.id
                  ? "resolved"
                  : target.external
                    ? "external"
                    : "unresolved",
              line,
            });
        } else if (ts.isIdentifier(node)) {
          const symbol = symbolAt(node);
          const target = targetFor(symbol);
          const declaration = target.id
            ? result.declarations.get(target.id)
            : undefined;
          if (
            target.id &&
            (ts.isPropertyAccessExpression(node.parent) ||
              node !== (node.parent as ts.NamedDeclaration).name)
          ) {
            result.references ??= new Map();
            const references = result.references.get(file) ?? [];
            references.push({
              start: node.getStart(source),
              end: node.getEnd(),
              from: owner,
              to: target.id,
            });
            result.references.set(file, references);
          }
          // Types and object values referenced by a function get distinct non-call links.
          const targetNode = symbol?.declarations?.find(
            (d) => declarations.get(d) === target.id,
          );
          const kind =
            declaration?.kind ??
            (targetNode ? definition(targetNode)?.kind : undefined);
          if (
            target.id &&
            target.id !== owner &&
            kind &&
            kind !== "function" &&
            node !== (node.parent as ts.NamedDeclaration).name &&
            relative(
              result.root,
              targetNode?.getSourceFile().fileName ?? source.fileName,
            ) !== file
          ) {
            result.connections.push({
              from: owner,
              to: target.id,
              label: node.text,
              kind: "reference",
              status: "resolved",
              line,
            });
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  // Eliminate repeated call sites from the hierarchy, while retaining one source line of evidence.
  const unique = new Map<string, Connection>();
  for (const edge of result.connections) {
    if (edge.to && !result.declarations.has(edge.to)) {
      edge.to = undefined;
      edge.status = "unresolved";
    }
    const key = JSON.stringify([
      edge.from,
      edge.to,
      edge.label,
      edge.kind,
      edge.status,
    ]);
    if (!unique.has(key)) unique.set(key, edge);
  }
  const fileOrder = new Map(result.files.map((file, index) => [file, index]));
  const ownerOrder = (edge: Connection) =>
    fileOrder.get(result.declarations.get(edge.from)?.file ?? "") ?? -1;
  result.connections = [...unique.values()].sort(
    (a, b) => ownerOrder(a) - ownerOrder(b),
  );
  const initializers = new Set(result.connections.map((e) => e.from));
  for (const [id, declaration] of result.declarations)
    if (declaration.kind === "initialization" && !initializers.has(id))
      result.declarations.delete(id);
  result.warnings = [...warningSet];
  return result;
}
