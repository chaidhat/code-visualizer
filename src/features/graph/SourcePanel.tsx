"use client";
import { useEffect, useState } from "react";
import type { Connection, Declaration, Span } from "@/shared/graph";
import { request } from "../workspace/api";
export default function SourcePanel({
  token,
  project,
  connection,
  declaration,
  onClose,
  onFollow,
}: {
  token: string;
  project: string;
  connection?: Connection;
  declaration?: Declaration;
  onClose: () => void;
  onFollow: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [source, setSource] = useState<{
    start: number;
    text: string;
    file: string;
  }>();
  const [error, setError] = useState("");
  const locations: Span[] =
    connection?.evidence ??
    (declaration && !declaration.external ? [declaration.span] : []);
  const location = locations[index] ?? locations[0];
  useEffect(() => {
    setIndex(0);
  }, [connection?.id, declaration?.id]);
  useEffect(() => {
    setSource(undefined);
    setError("");
    if (!location) return;
    const controller = new AbortController();
    void request<NonNullable<typeof source>>(
      token,
      `projects/${project}/source?file=${encodeURIComponent(location.file)}&start=${location.line}&end=${Math.min(location.endLine, location.line + 200)}`,
      { signal: controller.signal },
    )
      .then(setSource)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [token, project, location]);
  return (
    <aside className="source-panel">
      <div className="heading">
        <h2>Source evidence</h2>
        <button onClick={onClose}>Close</button>
      </div>
      <h3>
        {declaration?.name ??
          (connection?.relation === "callback"
            ? "Passed as callback"
            : "Function call")}
      </h3>
      {connection && (
        <>
          <button
            onClick={() =>
              onFollow(connection.evidence[index]?.target ?? connection.target)
            }
          >
            Go to target
          </button>
          <p>
            {connection.resolution}.{" "}
            {connection.evidence[index]?.reason ?? connection.reason}
          </p>
          <p>
            {connection.evidence[index]?.conditions.join(", ") ||
              "No enclosing conditional context"}
          </p>
          <label>
            Call location{" "}
            <select
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
            >
              {locations.map((s, i) => (
                <option key={i} value={i}>
                  {s.file}:{s.line}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {source ? (
        <>
          <p>{source.file}</p>
          <pre>
            {source.text.split("\n").map((line, i) => (
              <div
                className={
                  source.start + i >= location.line &&
                  source.start + i <= location.endLine
                    ? "evidence-line"
                    : ""
                }
                key={i}
              >
                <span>{source.start + i}</span>
                {line || " "}
              </div>
            ))}
          </pre>
        </>
      ) : (
        !error && (
          <p>
            {location
              ? "Loading source…"
              : "External source is not available for browsing."}
          </p>
        )
      )}
    </aside>
  );
}
