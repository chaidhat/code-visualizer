# Validation

## Environment

Checked September 12, 2026 on macOS arm64, Apple M4, Node.js 25.2.1. Dependencies are pinned in the lockfile. Browser checks used Arc with its Chromium 152 developer tools.

## Automated checks

The test suite covers direct calls, import aliases, re-exports, branch alternatives, recursion, callbacks, object initialization, nested objects, constructors, overloaded methods, duplicate scopes, reassignment, runtime property access, optional calls, missing imports, JavaScript fallback, malformed settings, project references, JSX callbacks, interface methods, and all major conditional forms.

Access tests cover unexpected Host and Origin, missing session keys, cross-site requests, outside symbolic links, cycles, private-file exclusions, size limits, source changes, removed files, traversal, worker completion, worker failure, and cancellation. Layout tests verify that refresh preserves unique identities and drops missing or ambiguous entries.

`npm run smoke` exercises the running Next.js app, from session setup and folder browsing through analysis, graph download, source evidence, cancellation, and rejected unauthorized requests. It uses raw HTTP for the unexpected-Host test because Node's fetch normalizes that header.

Type checking, the test suite, the production build, and formatting are required before changes are committed.

## Browser checks

Arc loaded the page, selected the example project, displayed 10 declarations and 8 connections, and completed **Arrange** in 151 ms after the ELK worker integration was corrected. These checks exposed a worker startup failure that did not appear in the production build or server tests.

The computer-control connection intermittently returned blank captures or failed clicks. Browser controls were also exercised through Arc's developer console. This does not establish smooth physical dragging or a 60 FPS guarantee. The map reports the last drag's measured frame intervals so this can be checked on the user's actual view.

## Synthetic scale results

The following are separate analysis-worker and Node-based ELK layout measurements. Layout measurements use collapsed, disconnected file containers. They do not measure browser rendering, graph download latency, or crowded cross-file routing. The fixtures include cycles and dense calls within files.

### Small

10 files, 100 declarations, 170 connections. Analysis 205 ms. Layout 50 ms. Process memory at completion 356 MiB. Serialized graph 0.09 MiB.

### Medium

500 files, 5,000 declarations, 8,500 connections. Analysis 725 ms. Layout 87 ms. Process memory at completion 595 MiB. Serialized graph 4.78 MiB.

### Large

2,000 files, 20,000 declarations, 34,000 connections. Analysis 4,270 ms. Layout 169 ms. Process memory at completion 623 MiB. Serialized graph 19.38 MiB.

### Dense calls

50 files, 1,050 declarations, 10,950 connections. Analysis 370 ms. Layout 8 ms. Process memory at completion 964 MiB. Serialized graph 4.95 MiB.

### One large file

1 file, 20,000 declarations, 39,997 connections. Analysis 1,466 ms. Layout 14 ms. Process memory at completion 1,144 MiB. Serialized graph 22.98 MiB.

### Measurement limits

The memory value is Node's process-wide resident memory sampled at analysis completion. It includes the benchmark runner and may include prior allocations. It is not an isolated worker peak. Graph pages contain up to 1,000 records of each kind. Large source evidence and dense edges can still make a page substantial.

The 60 FPS interaction target remains unverified. No claim is made that analysis timings demonstrate browser frame rates. Large file rows are bounded at 150 with full search and focus coverage, rather than using a separate scrolling virtualization package.
