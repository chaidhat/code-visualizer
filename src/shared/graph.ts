export type Span = {
  file: string;
  start: number;
  end: number;
  line: number;
  endLine: number;
};
export type Declaration = {
  id: string;
  file: string;
  name: string;
  kind: string;
  owner?: string;
  span: Span;
  external?: boolean;
};
export type Connection = {
  id: string;
  source: string;
  target: string;
  relation: "call" | "callback";
  resolution: "resolved" | "possible" | "unresolved" | "external";
  reason?: string;
  evidence: (Span & {
    expression: string;
    conditions: string[];
    source?: string;
    target?: string;
    reason?: string;
  })[];
};
export type FileEntry = {
  id: string;
  path: string;
  supported: boolean;
  digest?: string;
  reason?: string;
};
export type Graph = {
  version: string;
  createdAt: string;
  files: FileEntry[];
  declarations: Declaration[];
  connections: Connection[];
  diagnostics: string[];
  skipped: Record<string, number>;
  incoming: Record<string, string[]>;
  outgoing: Record<string, string[]>;
  metrics: { analysisMs: number; peakMemoryBytes: number };
};
export type JobStatus = {
  id: string;
  label: string;
  layoutKey: string;
  state: "running" | "complete" | "cancelled" | "failed";
  progress: string;
  error?: string;
};

export type GraphPage = {
  version: string;
  meta?: Graph;
  files: FileEntry[];
  declarations: Declaration[];
  connections: Connection[];
  next: number | null;
};
