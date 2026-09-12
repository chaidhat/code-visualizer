"use client";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useReactFlow,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Graph, Connection, Declaration } from "@/shared/graph";
import ELK from "elkjs/lib/elk-api.js";
import FileNode from "./FileNode";
import DeclarationNode from "./DeclarationNode";
const nodeTypes = { file: FileNode, declaration: DeclarationNode };
import {
  preferencesSchema,
  reconcilePreferences,
  defaults,
  type Preferences,
} from "./preferences";
function Canvas({
  graph,
  layoutKey,
  onInspect,
  focusTarget,
}: {
  graph: Graph;
  layoutKey: string;
  focusTarget?: string;
  onInspect: (value: Connection | Declaration) => void;
}) {
  const flow = useReactFlow();
  const skipSave = useRef(false);
  const frames = useRef<{ id: number; last: number; times: number[] }>({
    id: 0,
    last: 0,
    times: [],
  });
  const [frameReport, setFrameReport] = useState("");
  const key = `code-visualizer:${layoutKey}`;
  const [prefs, setPrefs] = useState<Preferences>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = preferencesSchema.safeParse(JSON.parse(raw));
        if (parsed.success) return reconcilePreferences(parsed.data, graph);
      }
    } catch {}
    return {
      ...defaults,
      collapsed:
        graph.declarations.length > 100
          ? graph.files.filter((f) => f.supported).map((f) => f.id)
          : [],
    };
  });
  const previousVersion = useRef(graph.version);
  useEffect(() => {
    if (previousVersion.current !== graph.version) {
      previousVersion.current = graph.version;
      setPrefs((p) => reconcilePreferences(p, graph));
      setSelected((id) =>
        graph.declarations.some((d) => d.id === id) ? id : undefined,
      );
    }
  }, [graph.version]);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const [overview, setOverview] = useState(false);
  const [warning, setWarning] = useState("");
  const [arranging, setArranging] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const layoutWorker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const declarations = useMemo(
    () => new Map(graph.declarations.map((d) => [d.id, d])),
    [graph],
  );
  const adjacency = useMemo(() => {
    const map = new Map<string, Connection[]>();
    for (const e of graph.connections) {
      for (const id of [e.source, e.target]) {
        const list = map.get(id) ?? [];
        list.push(e);
        map.set(id, list);
      }
    }
    return map;
  }, [graph]);
  const children = useMemo(() => {
    const ids = new Set<string>();
    for (const d of graph.declarations) if (d.owner) ids.add(d.owner);
    return ids;
  }, [graph]);
  const toggleCollapse = useCallback(
    (id: string) =>
      setPrefs((p) => ({
        ...p,
        collapsed: p.collapsed.includes(id)
          ? p.collapsed.filter((x) => x !== id)
          : [...p.collapsed, id],
      })),
    [],
  );
  const togglePin = useCallback(
    (id: string) =>
      setPrefs((p) => ({
        ...p,
        pins: p.pins.includes(id)
          ? p.pins.filter((x) => x !== id)
          : [...p.pins, id],
      })),
    [],
  );
  const visible = useMemo(() => {
    if (!prefs.focus || !selected) return null;
    const result = new Set([selected]);
    let frontier = [selected];
    for (let i = 0; i < prefs.steps; i++) {
      const next: string[] = [];
      for (const id of frontier)
        for (const e of adjacency.get(id) ?? [])
          for (const end of [e.source, e.target])
            if (!result.has(end)) {
              result.add(end);
              next.push(end);
            }
      frontier = next;
    }
    return result;
  }, [prefs.focus, prefs.steps, selected, adjacency]);
  const drawing = useMemo(() => {
    const collapsed = new Set(prefs.collapsed);
    const pins = new Set(prefs.pins);
    const output: Node[] = [];
    const endpoint = new Map<string, string>();
    const fileGroups = new Map<string, Declaration[]>();
    for (const d of graph.declarations) {
      if (visible && !visible.has(d.id)) continue;
      if (!prefs.external && d.external) continue;
      if (!prefs.uncertain && d.kind === "unresolved") continue;
      const list = fileGroups.get(d.file) ?? [];
      list.push(d);
      fileGroups.set(d.file, list);
    }
    if (!visible)
      for (const f of graph.files.filter((f) => f.supported))
        if (!fileGroups.has(f.id)) fileGroups.set(f.id, []);
    let groupIndex = 0;
    for (const [file, entries] of [...fileGroups].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const isCollapsed = collapsed.has(file) || overview;
      let row = 0;
      const rows: Node[] = [];
      for (const d of entries) {
        if (row >= 150 && !pins.has(d.id) && d.id !== selected) {
          endpoint.set(d.id, file);
          continue;
        }
        let parent = d.owner;
        let boundary: string | undefined;
        const seen = new Set<string>();
        while (parent && !seen.has(parent)) {
          seen.add(parent);
          if (collapsed.has(parent)) boundary = parent;
          parent = declarations.get(parent)?.owner;
        }
        if (pins.has(d.id)) {
          endpoint.set(d.id, d.id);
        } else if (isCollapsed) {
          endpoint.set(d.id, file);
          continue;
        } else if (boundary) {
          endpoint.set(d.id, boundary);
          continue;
        } else {
          endpoint.set(d.id, d.id);
        }
        const pinned = pins.has(d.id);
        const depth = (() => {
          let n = 0;
          let owner = d.owner;
          const seen = new Set<string>();
          while (owner && !seen.has(owner)) {
            seen.add(owner);
            n++;
            owner = declarations.get(owner)?.owner;
          }
          return Math.min(n, 4);
        })();
        rows.push({
          id: d.id,
          type: "declaration",
          parentId: pinned ? undefined : file,
          extent: pinned ? undefined : "parent",
          position:
            prefs.positions[d.id] ??
            (pinned
              ? { x: 900 + (row % 3) * 350, y: row * 60 }
              : { x: 14 + depth * 10, y: 76 + row++ * 48 }),
          style: { width: 300 - depth * 10, height: 40 },
          selected: d.id === selected,
          data: {
            label: d.name,
            kind: d.kind,
            owner: d.owner ? declarations.get(d.owner)?.name : undefined,
            file: d.file,
            pinned,
            hasChildren: children.has(d.id),
            collapsed: collapsed.has(d.id),
            onPin: togglePin,
            onCollapse: toggleCollapse,
          },
        });
      }
      const saved = prefs.positions[file];
      const maxY = Math.max(
        120,
        ...rows.filter((r) => r.parentId).map((r) => r.position.y + 65),
      );
      output.push({
        id: file,
        type: "file",
        position: saved ?? {
          x: (groupIndex % 5) * 410,
          y: Math.floor(groupIndex / 5) * 420,
        },
        style: { width: 355, height: isCollapsed ? 80 : maxY },
        data: {
          label: file,
          count: entries.length,
          collapsed: isCollapsed,
          onCollapse: toggleCollapse,
        },
      });
      output.push(...rows);
      groupIndex++;
    }
    const drawnIds = new Set(output.map((n) => n.id));
    for (const [id, target] of endpoint)
      if (!drawnIds.has(target)) endpoint.set(id, declarations.get(id)!.file);
    const aggregated = new Map<string, Edge>();
    const evidence = new Map<string, Connection>();
    for (const e of graph.connections) {
      if (
        (!prefs.external && e.resolution === "external") ||
        (!prefs.uncertain && ["possible", "unresolved"].includes(e.resolution))
      )
        continue;
      const source = endpoint.get(e.source),
        target = endpoint.get(e.target);
      if (!source || !target) continue;
      const id = `${source}:${target}:${e.resolution}:${e.relation}`;
      const previous = aggregated.get(id);
      const count = Number(previous?.data?.count ?? 0) + e.evidence.length;
      aggregated.set(id, {
        id,
        source,
        target,
        label: `${e.relation === "callback" ? "Passed as callback · " : ""}${count}`,
        data: { count },
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          stroke:
            e.resolution === "unresolved"
              ? "#b47831"
              : e.resolution === "possible"
                ? "#9274b5"
                : "#718c90",
          strokeDasharray: ["possible", "unresolved"].includes(e.resolution)
            ? "5 5"
            : undefined,
          strokeWidth:
            selected && (e.source === selected || e.target === selected)
              ? 3
              : 1.2,
        },
      });
      const prior = evidence.get(id);
      evidence.set(
        id,
        prior ? { ...prior, evidence: [...prior.evidence, ...e.evidence] } : e,
      );
    }
    return { nodes: output, edges: [...aggregated.values()], evidence };
  }, [
    graph,
    prefs.collapsed,
    prefs.pins,
    prefs.external,
    prefs.uncertain,
    visible,
    overview,
    selected,
    declarations,
    children,
    toggleCollapse,
    togglePin,
  ]);
  useEffect(() => {
    generation.current++;
    layoutWorker.current?.terminate();
    setArranging(false);
    setNodes((current) => {
      const previous = new Map(current.map((n) => [n.id, n]));
      return drawing.nodes.map((n) => {
        const old = previous.get(n.id);
        return old && old.parentId === n.parentId
          ? { ...n, position: old.position }
          : n;
      });
    });
  }, [drawing, setNodes]);
  function persist(next: Preferences) {
    try {
      const keys = Object.keys(localStorage).filter((k) =>
        k.startsWith("code-visualizer:"),
      );
      for (const stale of keys
        .filter((k) => k !== key)
        .slice(0, Math.max(0, keys.length - 7)))
        localStorage.removeItem(stale);
      const text = JSON.stringify(next);
      if (text.length > 2_000_000) throw new Error();
      localStorage.setItem(key, text);
    } catch {
      setWarning("Layout could not be saved in this browser.");
    }
  }
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    persist(prefs);
  }, [prefs]);
  function arrange() {
    layoutWorker.current?.terminate();
    const worker = new Worker(new URL("./layout.worker.ts", import.meta.url));
    layoutWorker.current = worker;
    const version = ++generation.current;
    setArranging(true);
    const top = nodes.filter((n) => !n.parentId);
    const topIds = new Set(top.map((n) => n.id));
    const parents = new Map(nodes.map((n) => [n.id, n.parentId ?? n.id]));
    const elk = new ELK({ workerFactory: () => worker });
    const started = performance.now();
    const apply = (positions: Record<string, { x: number; y: number }>) => {
      if (version !== generation.current) return;
      setArranging(false);
      worker.terminate();
      setNodes((current) =>
        current.map((n) =>
          positions[n.id] ? { ...n, position: positions[n.id] } : n,
        ),
      );
      setPrefs((p) => ({ ...p, positions: { ...p.positions, ...positions } }));
      setFrameReport(`Layout: ${Math.round(performance.now() - started)} ms`);
      requestAnimationFrame(() => {
        void flow.fitView({ maxZoom: 1, padding: 0.15 });
      });
    };
    worker.onerror = () => {
      setArranging(false);
      setWarning("Automatic arrangement failed.");
      worker.terminate();
    };
    void elk
      .layout({
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "DOWN",
          "elk.spacing.nodeNode": "55",
          "elk.layered.spacing.nodeNodeBetweenLayers": "100",
        },
        children: top.map((n) => ({
          id: n.id,
          width: Number(n.style?.width ?? 355),
          height: Number(n.style?.height ?? 100),
        })),
        edges: drawing.edges
          .map((e) => ({
            ...e,
            source: parents.get(e.source) ?? e.source,
            target: parents.get(e.target) ?? e.target,
          }))
          .filter(
            (e) =>
              topIds.has(e.source) &&
              topIds.has(e.target) &&
              e.source !== e.target,
          )
          .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      })
      .then((result) =>
        apply(
          Object.fromEntries(
            (result.children ?? []).map((n) => [
              n.id,
              { x: n.x ?? 0, y: n.y ?? 0 },
            ]),
          ),
        ),
      )
      .catch(() => {
        if (version === generation.current) {
          setArranging(false);
          setWarning(
            "Automatic arrangement failed. You can still move cards manually.",
          );
        }
        worker.terminate();
      });
  }
  const initialLayout = useRef(false);
  useEffect(() => {
    if (nodes.length && !initialLayout.current) {
      initialLayout.current = true;
      if (!Object.keys(prefs.positions).length) arrange();
    }
  }, [nodes]);
  useEffect(() => () => layoutWorker.current?.terminate(), []);
  const results = useMemo(
    () =>
      query
        ? graph.declarations
            .filter((d) =>
              `${d.name} ${d.file}`.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 80)
        : [],
    [query, graph],
  );
  useEffect(() => {
    if (focusTarget) {
      const d = declarations.get(focusTarget);
      if (d) selectDeclaration(d);
    }
  }, [focusTarget]);
  useEffect(() => {
    if (selected && prefs.focus) {
      const timer = setTimeout(() => {
        void flow.fitView({
          nodes: [{ id: selected }],
          maxZoom: 1.2,
          duration: 200,
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selected, prefs.focus]);
  function selectDeclaration(d: Declaration) {
    setSelected(d.id);
    onInspect(d);
    setPrefs((p) => ({
      ...p,
      focus: true,
      collapsed: p.collapsed.filter((id) => id !== d.file && id !== d.owner),
    }));
  }
  return (
    <div className="map-shell">
      <div className="map-toolbar">
        <input
          aria-label="Search files and declarations"
          placeholder="Search files or declarations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={prefs.focus}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, focus: e.target.checked }))
            }
          />{" "}
          Focus
        </label>
        <select
          aria-label="Connection steps"
          value={prefs.steps}
          onChange={(e) =>
            setPrefs((p) => ({ ...p, steps: Number(e.target.value) }))
          }
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} step{n > 1 ? "s" : ""}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={prefs.external}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, external: e.target.checked }))
            }
          />{" "}
          External
        </label>
        <label>
          <input
            type="checkbox"
            checked={prefs.uncertain}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, uncertain: e.target.checked }))
            }
          />{" "}
          Uncertain
        </label>
        <button onClick={arrange} disabled={arranging}>
          {arranging ? "Arranging…" : "Arrange"}
        </button>
        <button
          onClick={() => {
            try {
              localStorage.removeItem(key);
            } catch {
              setWarning("Browser storage is unavailable.");
              return;
            }
            skipSave.current = true;
            setNodes([]);
            setPrefs({ ...defaults });
            setWarning("Saved layout cleared.");
          }}
        >
          Clear saved layout
        </button>
      </div>
      {query && (
        <div className="search-results">
          {results.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                selectDeclaration(d);
                setQuery("");
              }}
            >
              {d.name}
              <small>{d.file}</small>
            </button>
          ))}
          {graph.files
            .filter(
              (f) =>
                !f.supported &&
                f.path.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 30)
            .map((f) => (
              <p key={f.id}>
                {f.path} · {f.reason}
              </p>
            ))}
          {!results.length && <p>No matching declarations.</p>}
        </div>
      )}
      {warning && (
        <div role="status" className="notice">
          {warning}
          <button onClick={() => setWarning("")}>Dismiss</button>
        </div>
      )}
      <div className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={drawing.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStart={() => {
            cancelAnimationFrame(frames.current.id);
            frames.current = { id: 0, last: performance.now(), times: [] };
            const sample = (now: number) => {
              frames.current.times.push(now - frames.current.last);
              frames.current.last = now;
              frames.current.id = requestAnimationFrame(sample);
            };
            frames.current.id = requestAnimationFrame(sample);
          }}
          onNodeDragStop={(_, node) => {
            cancelAnimationFrame(frames.current.id);
            const times = frames.current.times.sort((a, b) => a - b);
            if (times.length)
              setFrameReport(
                `Last drag: ${times.length} frames, ${times[Math.floor(times.length * 0.95)].toFixed(1)} ms at 95%`,
              );
            const next = {
              ...prefsRef.current,
              positions: {
                ...prefsRef.current.positions,
                [node.id]: node.position,
              },
            };
            setPrefs(next);
          }}
          onNodeClick={(_, node) => {
            const d = declarations.get(node.id);
            if (d) {
              setSelected(d.id);
              onInspect(d);
            }
          }}
          onEdgeClick={(_, edge) => {
            const value = drawing.evidence.get(edge.id);
            if (value) onInspect(value);
          }}
          onMoveEnd={(_, viewport) => setOverview(viewport.zoom < 0.35)}
          minZoom={0.08}
          maxZoom={2}
          fitView
          onlyRenderVisibleElements
        >
          <Background gap={24} color="#d9dcd7" />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <div className="legend">
        <span>→ Known call</span>
        <span>{frameReport}</span>
        <span>Up to 150 rows per file. Search reveals any declaration.</span>
        <span>┄ Possible or unresolved</span>
        <span>Arrows show source calls, not proof of execution.</span>
        <span>
          {nodes.length} visible entries · {graph.declarations.length}{" "}
          declarations · {drawing.edges.length} shown /{" "}
          {graph.connections.length} connections
        </span>
      </div>
    </div>
  );
}
export default function GraphCanvas(props: Parameters<typeof Canvas>[0]) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
