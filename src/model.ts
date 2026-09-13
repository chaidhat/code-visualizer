export interface Declaration {
  id: string;
  file: string;
  name: string;
  kind: "function" | "class" | "object" | "type" | "initialization";
  start: number;
  end: number;
  line: number;
  parent?: string;
}

export interface Connection {
  from: string;
  to?: string;
  label: string;
  kind: "call" | "reference";
  status: "resolved" | "external" | "unresolved";
  line: number;
}

export interface Snapshot {
  analysis?: { analyzedFiles: number; reusedFiles: number };
  root: string;
  files: string[];
  declarations: Map<string, Declaration>;
  connections: Connection[];
  warnings: string[];
  references?: Map<
    string,
    { start: number; end: number; from?: string; to?: string }[]
  >;
}

export interface ReadProgress {
  read: number;
  total: number;
}

export type AnalysisMessage =
  | { type: "progress"; progress: ReadProgress }
  | { type: "result"; snapshot: Snapshot };
