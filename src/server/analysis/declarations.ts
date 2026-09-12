import ts from "typescript";
import path from "node:path";
import type { Declaration, Span } from "../../shared/graph";
export function span(node: ts.Node, root: string): Span {
  const source = node.getSourceFile();
  const start = node.getStart(source);
  return {
    file: path.relative(root, source.fileName),
    start,
    end: node.end,
    line: source.getLineAndCharacterOfPosition(start).line + 1,
    endLine: source.getLineAndCharacterOfPosition(node.end).line + 1,
  };
}
export function extractDeclarations(source: ts.SourceFile, root: string) {
  const file = path.relative(root, source.fileName);
  const declarations: Declaration[] = [];
  const nodes = new Map<ts.Node, string>();
  const owners = new Map<ts.Node, string>();
  const counts = new Map<string, number>();
  function add(node: ts.Node, name: string, kind: string, owner?: string) {
    const base = `${owner ?? file}::${kind}:${name}`;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    const id = `${base}#${count}`;
    declarations.push({ id, file, name, kind, owner, span: span(node, root) });
    nodes.set(node, id);
    return id;
  }
  const initialization = add(source, "File initialization", "initialization");
  function visit(node: ts.Node, owner: string, executionOwner: string) {
    let next = owner;
    let caller = executionOwner;
    if (
      ts.isFunctionLike(node) &&
      !ts.isFunctionTypeNode(node) &&
      !ts.isCallSignatureDeclaration(node) &&
      !ts.isConstructSignatureDeclaration(node)
    ) {
      const named = node as ts.FunctionLikeDeclaration;
      const name =
        named.name?.getText(source) ??
        (ts.isVariableDeclaration(node.parent) ||
        ts.isPropertyAssignment(node.parent) ||
        ts.isPropertyDeclaration(node.parent)
          ? node.parent.name.getText(source)
          : ts.isConstructorDeclaration(node)
            ? "constructor"
            : `callback at line ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      next = add(
        node,
        name,
        ts.isMethodDeclaration(node)
          ? "method"
          : ts.isConstructorDeclaration(node)
            ? "constructor"
            : "function",
        owner === initialization ? undefined : owner,
      );
      if (
        ts.isVariableDeclaration(node.parent) ||
        ts.isPropertyAssignment(node.parent) ||
        ts.isPropertyDeclaration(node.parent)
      )
        nodes.set(node.parent, next);
      caller = next;
    } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      next = add(
        node,
        node.name?.text ?? "Anonymous class",
        "class",
        owner === initialization ? undefined : owner,
      );
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isObjectLiteralExpression(node.initializer) ||
        ts.isNewExpression(node.initializer))
    ) {
      next = add(
        node,
        node.name.getText(source),
        "object",
        owner === initialization ? undefined : owner,
      );
    } else if (
      ts.isPropertyAssignment(node) &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      next = add(node, node.name.getText(source), "object", owner);
    } else if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node)
    ) {
      next = add(
        node,
        node.name.text,
        "type",
        owner === initialization ? undefined : owner,
      );
    }
    if (
      next !== owner &&
      (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node))
    ) {
      caller = add(node, "Object initialization", "initialization", next);
      nodes.set(node, next);
    }
    if (
      ts.isPropertyDeclaration(node) &&
      node.initializer &&
      !ts.isArrowFunction(node.initializer) &&
      !ts.isFunctionExpression(node.initializer)
    ) {
      const isStatic = node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.StaticKeyword,
      );
      caller = add(
        node,
        `${node.name.getText(source)} ${isStatic ? "static" : "instance"} initialization`,
        "initialization",
        owner,
      );
    }
    if (ts.isClassStaticBlockDeclaration(node))
      caller = add(node, "Static initialization", "initialization", owner);
    owners.set(node, caller);
    ts.forEachChild(node, (child) => visit(child, next, caller));
  }
  ts.forEachChild(source, (n) => visit(n, initialization, initialization));
  return { declarations, nodes, owners, initialization };
}
