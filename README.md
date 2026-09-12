# Code Visualizer

Explore a local TypeScript or JavaScript project as draggable file cards, declarations, and source-backed call connections. Source stays on your computer and selected projects are never executed or modified.

## Start

Requires Node.js 20.9 or newer and npm. The implementation was checked on Node.js 25.2.1 on macOS with Apple M4.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:3000` in Arc. Choose **Select folder**, browse or paste an absolute path, then choose **Use this folder**. Try the included `examples/branching` folder first.

Use `npm run build` followed by `npm start` for the production build. Always use these scripts. They bind to loopback, disable Next.js telemetry, prepare the local workers, and create the session key used to protect file access. Restart `npm run dev` after changing analysis-worker code.

## Explore

- Drag file cards and individual rows. Pin a row to detach it from its card while keeping its file label.
- Select a declaration to highlight its connections. Select an arrow to read every source location behind it, then use **Go to target**.
- Search all file and declaration names. Search results remain available when cards are collapsed or rows are not drawn.
- Use **Focus** and the step selector to follow nearby calls. Toggle **External** and **Uncertain** to simplify the view.
- Collapse files or nested declarations to group their connections. Overview zoom shows file boundaries. Large files draw up to 150 rows. Search or focus reveals other entries.
- Use **Arrange** to run ELK in a browser worker. Dragging does not rerun analysis or arrangement.
- Use **Refresh** after source changes. Unique surviving declarations retain saved positions. Ambiguous duplicate names lose saved positions rather than borrowing another entry's position.
- **Clear saved layout** removes this project's saved positions, pins, and filters. Up to eight layouts are retained, with a 2 MB maximum per saved layout. Source code is never put in browser storage.

## Read the arrows

Solid arrows identify a declared target. Dashed arrows show possible or unresolved targets. Conditional context is listed separately in source evidence. Calls from every branch are inspected, including calls that may never run.

Passing a function is labeled **Passed as callback**. Its body owns its calls. Objects, constructors, methods, and initialization entries have separate ownership. Dynamic property names, reassigned function values, missing imports, and interface implementations without an established runtime target remain visibly uncertain.

This is a snapshot of source relationships, not a runtime trace. Missing arrows do not prove a declaration is unused. A changed source file must be refreshed before its evidence can be opened.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm run format:check
npm run benchmark
```

With the app running, `npm run smoke` verifies the local routes using the example project. It replaces the current in-memory project, so select your folder again afterward.

See [validation results](docs/validation.md), the [implementation design](docs/design/code-visualizer.md), and [local privacy boundaries](docs/design/privacy.md).

## Implementation and dependencies

The app uses Next.js and React Flow. The analyzer uses TypeScript 5.9.3 because it supplies the stable Compiler API and Language Service used here. TypeScript 7 uses a different API. Dependencies are pinned in `package.json` and the npm lockfile.

ELK's original worker is copied from the installed `elkjs` package during worker preparation. Its license notice remains in that generated local asset. No worker or page script is loaded from a hosted service. Official references: [Next.js routes](https://nextjs.org/docs/app/getting-started/route-handlers), [TypeScript Language Service](https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API), [React Flow groups](https://reactflow.dev/learn/layouting/sub-flows), and [ELK](https://github.com/kieler/elkjs).
