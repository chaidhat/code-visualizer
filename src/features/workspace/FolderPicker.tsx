"use client";
import { useState, useEffect } from "react";
import { request } from "./api";
export default function FolderPicker({
  token,
  onSelect,
  onClose,
}: {
  token: string;
  onSelect: (root: string) => void;
  onClose: () => void;
}) {
  const [folder, setFolder] = useState<{
    path: string;
    parent: string;
    directories: string[];
  }>();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function browse(value = "") {
    setBusy(true);
    setError("");
    try {
      const next = await request<NonNullable<typeof folder>>(
        token,
        `directories?path=${encodeURIComponent(value)}`,
      );
      setFolder(next);
      setInput(next.path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void browse();
  }, []); // The dialog is remounted for each selection.
  return (
    <div className="veil">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-title"
        className="dialog"
      >
        <div className="heading">
          <h2 id="folder-title">Select a local folder</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <p>Your source stays on this computer. Files are read only.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void browse(input);
          }}
        >
          <label htmlFor="folder-path">Absolute folder path</label>
          <div className="row">
            <input
              id="folder-path"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
            />
            <button disabled={busy}>Browse</button>
          </div>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="folders">
          <button
            disabled={busy || !folder}
            onClick={() => void browse(folder?.parent)}
          >
            ↑ Parent folder
          </button>
          {folder?.directories.map((name) => (
            <button
              disabled={busy}
              key={name}
              onClick={() => void browse(`${folder.path}/${name}`)}
            >
              ▱ {name}
            </button>
          ))}
        </div>
        <footer>
          <span>{busy ? "Reading folders…" : folder?.path}</span>
          <button
            className="primary"
            disabled={busy || !folder}
            onClick={() => folder && onSelect(folder.path)}
          >
            Use this folder
          </button>
        </footer>
      </section>
    </div>
  );
}
