import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import ts from "typescript";
import type { Graph, Declaration, Connection } from "../../shared/graph";
import { discover, contained } from "./discover";
import { createContexts } from "./project";
import { extractDeclarations, span } from "./declarations";
export function analyze(
  root: string,
  progress: (message: string) => void = () => {},
): Graph {
  root = fs.realpathSync(root);
  const started = performance.now();
  const discovery = discover(root, progress);
  const graph: Graph = {
    version: randomUUID(),
    createdAt: new Date().toISOString(),
    files: discovery.files,
    diagnostics: discovery.diagnostics,
    skipped: discovery.skipped,
    declarations: [],
    connections: [],
    incoming: {},
    outgoing: {},
    metrics: { analysisMs: 0, peakMemoryBytes: 0 },
  };
  const contexts = createContexts(
    root,
    discovery.files
      .filter((f) => f.supported)
      .map((f) => path.join(root, f.path)),
    discovery.configs,
    graph.diagnostics,
  );
  const declarations = new Map<string, Declaration>();
  const edges = new Map<string, Connection>();
  const processed = new Set<string>();
  for (const context of contexts) {
    const checker = context.program.getTypeChecker();
    const nodeIds = new Map<ts.Node, string>();
    const extracts = new Map<string, ReturnType<typeof extractDeclarations>>();
    for (const source of context.program.getSourceFiles()) {
      if (
        !contained(root, source.fileName) ||
        !discovery.files.some(
          (f) => f.supported && path.join(root, f.path) === source.fileName,
        )
      )
        continue;
      const entry = graph.files.find(
        (f) => path.join(root, f.path) === source.fileName,
      );
      if (entry)
        entry.digest = createHash("sha256").update(source.text).digest("hex");
      const extracted = extractDeclarations(source, root);
      extracts.set(source.fileName, extracted);
      for (const d of extracted.declarations) declarations.set(d.id, d);
      for (const [n, id] of extracted.nodes) nodeIds.set(n, id);
      // Navigation is useful corroboration, but the full tree walk owns coverage.
      context.service.getNavigationTree(source.fileName);
    }
    const symbolAt = (node: ts.Node) => {
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
        try {
          symbol = checker.getAliasedSymbol(symbol);
        } catch {
          return undefined;
        }
      }
      return symbol;
    };
    const writes = new Set<ts.Symbol>();
    for (const source of context.program
      .getSourceFiles()
      .filter((s) => extracts.has(s.fileName))) {
      const scan = (n: ts.Node) => {
        if (
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
          const symbol = symbolAt(
            ts.isPropertyAccessExpression(n.left) ? n.left.name : n.left,
          );
          if (symbol) writes.add(symbol);
        }
        ts.forEachChild(n, scan);
      };
      scan(source);
    }
    type Target = {
      id?: string;
      resolution: Connection["resolution"];
      reason?: string;
    };
    function resolve(
      expression: ts.Expression,
      seen = new Set<ts.Node>(),
    ): Target[] {
      if (seen.has(expression) || seen.size >= 24)
        return [
          {
            resolution: "unresolved",
            reason: "Target exploration limit or alias cycle",
          },
        ];
      seen = new Set(seen).add(expression);
      if (
        ts.isParenthesizedExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isNonNullExpression(expression) ||
        ts.isSatisfiesExpression(expression)
      )
        return resolve(expression.expression, seen);
      if (ts.isConditionalExpression(expression))
        return [
          ...resolve(expression.whenTrue, seen),
          ...resolve(expression.whenFalse, seen),
        ].map((t) =>
          t.id
            ? {
                ...t,
                resolution: "possible",
                reason: "Conditional function choice",
              }
            : t,
        );
      const direct = nodeIds.get(expression);
      if (direct) return [{ id: direct, resolution: "resolved" }];
      if (ts.isElementAccessExpression(expression))
        return [
          {
            resolution: "unresolved",
            reason: "Runtime property access is not resolved",
          },
        ];
      const symbol = symbolAt(
        ts.isPropertyAccessExpression(expression)
          ? expression.name
          : expression,
      );
      if (symbol && writes.has(symbol))
        return [
          {
            resolution: "unresolved",
            reason: "Target is reassigned in the analyzed project",
          },
        ];
      const ds = symbol?.declarations ?? [];
      for (const d of ds) {
        if (
          ts.isVariableDeclaration(d) &&
          d.initializer &&
          !ts.isNewExpression(d.initializer) &&
          !ts.isObjectLiteralExpression(d.initializer)
        )
          return resolve(d.initializer, seen);
        if (
          ts.isPropertyAssignment(d) &&
          !ts.isObjectLiteralExpression(d.initializer)
        )
          return resolve(d.initializer, seen);
      }
      const implementation = ds.find((d) => "body" in d && d.body) ?? ds[0];
      if (implementation) {
        const id = nodeIds.get(implementation);
        if (id)
          return [
            {
              id,
              resolution: ts.isMethodSignature(implementation)
                ? "unresolved"
                : "resolved",
              ...(ts.isMethodSignature(implementation) && {
                reason:
                  "Interface member is declared, but its runtime implementation is unknown",
              }),
            },
          ];
        const source = implementation.getSourceFile();
        if (
          !contained(root, source.fileName) ||
          source.isDeclarationFile ||
          source.fileName.includes(`${path.sep}node_modules${path.sep}`)
        ) {
          const id = `external:${createHash("sha256").update(source.fileName).digest("hex").slice(0, 16)}:${symbol?.getName()}:${implementation.pos}`;
          if (!declarations.has(id))
            declarations.set(id, {
              id,
              file: "External",
              name: expression.getText().slice(0, 160),
              kind: "external",
              external: true,
              span: { ...span(implementation, root), file: "External" },
            });
          return [
            {
              id,
              resolution: "external",
              reason: "Declaration from a dependency or type library",
            },
          ];
        }
        return [
          {
            resolution: "unresolved",
            reason: "Declared value has no established callable implementation",
          },
        ];
      }
      return [
        {
          resolution: "unresolved",
          reason: "Missing declaration or dynamically supplied target",
        },
      ];
    }
    for (const [file, extracted] of extracts) {
      if (processed.has(file)) continue;
      processed.add(file);
      const source = context.program.getSourceFile(file)!;
      progress(
        `Analyzing ${processed.size} of ${discovery.files.filter((f) => f.supported).length} source files`,
      );
      for (const diagnostic of [
        ...context.program.getSyntacticDiagnostics(source),
        ...context.program.getSemanticDiagnostics(source),
      ]) {
        if (graph.diagnostics.length >= 300) break;
        graph.diagnostics.push(
          `${path.relative(root, file)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").slice(0, 300)}`,
        );
      }
      // Query named callable roots as a cross-check. AST calls below retain unresolved calls.
      for (const [node] of extracted.nodes)
        if (ts.isFunctionDeclaration(node) && node.name && node.body) {
          const hierarchy = context.service.prepareCallHierarchy(
            file,
            node.name.getStart(),
          );
          if (hierarchy)
            context.service.provideCallHierarchyOutgoingCalls(
              file,
              node.name.getStart(),
            );
        }
      function record(
        call: ts.Node,
        expression: ts.Expression,
        relation: Connection["relation"],
        conditions: string[],
      ) {
        const caller = extracted.owners.get(call) ?? extracted.initialization;
        for (const target of resolve(expression)) {
          let id = target.id;
          if (id && ts.isNewExpression(call)) {
            const constructor = [...declarations.values()].find(
              (d) => d.owner === id && d.kind === "constructor",
            );
            if (constructor) id = constructor.id;
          }
          if (!id) {
            id = `unresolved:${path.relative(root, file)}:${call.getStart()}:${relation}`;
            declarations.set(id, {
              id,
              file: path.relative(root, file),
              name: expression.getText().slice(0, 120),
              kind: "unresolved",
              span: span(call, root),
            });
          }
          const key = `${caller}->${id}:${relation}:${target.resolution}`;
          let edge = edges.get(key);
          if (!edge) {
            edge = {
              id: key,
              source: caller,
              target: id,
              relation,
              resolution: target.resolution,
              reason: target.reason,
              evidence: [],
            };
            edges.set(key, edge);
          }
          const evidence = {
            ...span(call, root),
            expression: call.getText().slice(0, 300),
            source: caller,
            target: id,
            reason: target.reason,
            conditions,
          };
          if (
            !edge.evidence.some(
              (e) => e.start === evidence.start && e.file === evidence.file,
            )
          )
            edge.evidence.push(evidence);
        }
      }
      function visit(node: ts.Node, conditions: string[]) {
        let next = conditions;
        if (ts.isFunctionLike(node)) next = [];
        if (
          ts.isIfStatement(node) ||
          ts.isConditionalExpression(node) ||
          ts.isSwitchStatement(node) ||
          ts.isIterationStatement(node, false) ||
          ts.isTryStatement(node) ||
          (ts.isBinaryExpression(node) &&
            [
              ts.SyntaxKind.AmpersandAmpersandToken,
              ts.SyntaxKind.BarBarToken,
              ts.SyntaxKind.QuestionQuestionToken,
            ].includes(node.operatorToken.kind))
        )
          next = [
            ...next,
            `${ts.SyntaxKind[node.kind]} at line ${span(node, root).line}`,
          ];
        if (
          ts.isCallExpression(node) ||
          ts.isNewExpression(node) ||
          ts.isTaggedTemplateExpression(node)
        ) {
          const expression = ts.isTaggedTemplateExpression(node)
            ? node.tag
            : node.expression;
          const ownConditions =
            "questionDotToken" in node && node.questionDotToken
              ? [...next, "Optional call"]
              : next;
          record(node, expression, "call", ownConditions);
          if (!ts.isTaggedTemplateExpression(node))
            for (const arg of node.arguments ?? []) {
              if (
                ts.isArrowFunction(arg) ||
                ts.isFunctionExpression(arg) ||
                checker.getTypeAtLocation(arg).getCallSignatures().length
              )
                record(node, arg, "callback", ownConditions);
            }
        }
        ts.forEachChild(node, (child) => visit(child, next));
      }
      visit(source, []);
    }
    context.service.dispose();
  }
  for (const entry of graph.files.filter((f) => f.supported && !f.digest))
    graph.diagnostics.push(`Source could not be analyzed: ${entry.path}`);
  graph.declarations = [...declarations.values()];
  graph.connections = [...edges.values()];
  for (const edge of graph.connections) {
    (graph.outgoing[edge.source] ??= []).push(edge.id);
    (graph.incoming[edge.target] ??= []).push(edge.id);
  }
  if (graph.diagnostics.length >= 300)
    graph.diagnostics.push("Only the first 300 compiler warnings are shown.");
  graph.diagnostics = [...new Set(graph.diagnostics)];
  graph.metrics = {
    analysisMs: performance.now() - started,
    peakMemoryBytes: process.memoryUsage().rss,
  };
  return graph;
}
