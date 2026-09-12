"use client";
import { useEffect, useRef, useState } from "react";
import type {
  GraphPage,
  Graph,
  JobStatus,
  Connection,
  Declaration,
} from "@/shared/graph";
import { request } from "./api";
import FolderPicker from "./FolderPicker";
import GraphCanvas from "../graph/GraphCanvas";
import SourcePanel from "../graph/SourcePanel";
export default function Workspace() {
  const [token, setToken] = useState("");
  const [picker, setPicker] = useState(false);
  const [starting, setStarting] = useState(false);
  const [root, setRoot] = useState("");
  const [job, setJob] = useState<JobStatus>();
  const [graph, setGraph] = useState<Graph>();
  const [error, setError] = useState("");
  const [focusTarget, setFocusTarget] = useState<string>();
  const [inspection, setInspection] = useState<Connection | Declaration>();
  const [showWarnings, setShowWarnings] = useState(false);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    void request<{ token: string }>("", "session")
      .then((r) => setToken(r.token))
      .catch((e) => setError(e.message));
    return () => controller.current?.abort();
  }, []);
  async function start(folder: string) {
    const version = ++epoch.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setPicker(false);
    setStarting(true);
    setError("");
    setInspection(undefined);
    if (folder !== root) setGraph(undefined);
    setRoot(folder);
    try {
      const created = await request<JobStatus>(token, "projects", {
        method: "POST",
        body: JSON.stringify({ root: folder }),
      });
      if (version !== epoch.current) {
        // A cancelled selection still needs its server worker stopped once its ID arrives.
        try {
          await request(token, `projects/${created.id}`, { method: "DELETE" });
        } catch {
          /* A newer selection already released this project. */
        }
        return;
      }
      setStarting(false);
      setJob(created);
      let status = created;
      while (status.state === "running") {
        await new Promise<void>((resolve) => setTimeout(resolve, 450));
        if (abort.signal.aborted) return;
        status = await request<JobStatus>(token, `projects/${created.id}`, {
          signal: abort.signal,
        });
        if (version !== epoch.current) return;
        setJob(status);
      }
      if (status.state === "failed") throw new Error(status.error);
      if (status.state !== "complete") return;
      let offset: number | null = 0;
      let result: Graph | undefined;
      while (offset !== null) {
        const page: GraphPage = await request<GraphPage>(
          token,
          `projects/${created.id}/graph?offset=${offset}`,
          {
            signal: abort.signal,
          },
        );
        if (version !== epoch.current) return;
        if (!result) result = page.meta;
        if (!result) throw new Error("Snapshot metadata is missing.");
        if (result.version !== page.version)
          throw new Error("Snapshot changed. Refresh to try again.");
        result.files.push(...page.files);
        result.declarations.push(...page.declarations);
        result.connections.push(...page.connections);
        offset = page.next;
      }
      if (result && version === epoch.current) {
        for (const edge of result.connections) {
          (result.outgoing[edge.source] ??= []).push(edge.id);
          (result.incoming[edge.target] ??= []).push(edge.id);
        }
        setGraph(result);
      }
    } catch (e) {
      if (version === epoch.current) setStarting(false);
      if ((e as Error).name !== "AbortError" && version === epoch.current)
        setError((e as Error).message);
    }
  }
  async function cancel() {
    setStarting(false);
    epoch.current++;
    controller.current?.abort();
    if (job)
      try {
        setJob(
          await request<JobStatus>(token, `projects/${job.id}`, {
            method: "DELETE",
          }),
        );
      } catch (e) {
        setError((e as Error).message);
      }
  }
  return (
    <main>
      <header className="app-header">
        <a className="brand" href="/">
          ▦ <span>Code Visualizer</span>
        </a>
        <span className="local-badge">● Local only</span>
        <div className="header-actions">
          {job && <span>{job.label}</span>}
          <button disabled={!token} onClick={() => setPicker(true)}>
            Select folder
          </button>
          <button
            disabled={!root || job?.state === "running"}
            onClick={() => void start(root)}
          >
            Refresh
          </button>
        </div>
      </header>
      {error && (
        <div className="error banner" role="alert">
          {error}
        </div>
      )}
      {(starting || job?.state === "running") && (
        <div className="progress" role="status">
          <span className="spinner" />
          {starting ? "Opening folder…" : job?.progress}
          <button onClick={() => void cancel()}>Cancel</button>
        </div>
      )}
      {graph && job ? (
        <>
          <div className="snapshot">
            <span>
              Snapshot · {new Date(graph.createdAt).toLocaleTimeString()} ·{" "}
              {graph.files.filter((f) => f.supported).length} source files ·{" "}
              {(graph.metrics.analysisMs / 1000).toFixed(1)}s analysis
            </span>
            <button onClick={() => setShowWarnings(!showWarnings)}>
              {graph.diagnostics.length} warnings ·{" "}
              {Object.values(graph.skipped).reduce((a, b) => a + b, 0)} skipped
            </button>
          </div>
          {showWarnings && (
            <div className="warnings">
              {Object.entries(graph.skipped).map(([reason, count]) => (
                <p key={reason}>
                  {reason}: {count}
                </p>
              ))}
              {graph.diagnostics.map((message, i) => (
                <p key={i}>{message}</p>
              ))}
              <p>Missing arrows do not prove a declaration is unused.</p>
            </div>
          )}
          <div className="workspace">
            <GraphCanvas
              key={job.layoutKey}
              graph={graph}
              layoutKey={job.layoutKey}
              onInspect={(value) => {
                setInspection(value);
                setFocusTarget(undefined);
              }}
              focusTarget={focusTarget}
            />
            {inspection && job.state === "complete" && (
              <SourcePanel
                token={token}
                project={job.id}
                connection={"evidence" in inspection ? inspection : undefined}
                declaration={"span" in inspection ? inspection : undefined}
                onClose={() => setInspection(undefined)}
                onFollow={setFocusTarget}
              />
            )}
          </div>
        </>
      ) : (
        <section className="welcome">
          <div className="eyebrow">A CLEARER VIEW OF YOUR CODE</div>
          <h1>See how it all connects.</h1>
          <p>
            Explore your project as a map of files and functions.
            <br />
            Follow calls, inspect the source, and find the unknowns.
          </p>
          <button
            className="primary"
            disabled={!token}
            onClick={() => setPicker(true)}
          >
            Select a folder ↗
          </button>
          <div className="welcome-notes">
            <span>01 · Choose a local project</span>
            <span>02 · Explore its connections</span>
            <span>03 · Read the source evidence</span>
          </div>
          <p className="privacy-note">
            TypeScript and JavaScript. Read only. No source uploads.
          </p>
        </section>
      )}
      {picker && (
        <FolderPicker
          token={token}
          onSelect={(folder) => void start(folder)}
          onClose={() => setPicker(false)}
        />
      )}
    </main>
  );
}
