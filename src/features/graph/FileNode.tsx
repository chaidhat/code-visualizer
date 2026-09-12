"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
export type FileData = {
  label: string;
  count: number;
  collapsed: boolean;
  onCollapse: (id: string) => void;
  overview?: boolean;
};
export default memo(function FileNode({ id, data }: NodeProps<Node<FileData>>) {
  return (
    <div className="file-card">
      <Handle type="target" position={Position.Top} />
      <div className="file-title">
        <span title={data.label}>▱ {data.label}</span>
        <button
          className="nodrag"
          aria-label={`${data.collapsed ? "Expand" : "Collapse"} ${data.label}`}
          onClick={() => data.onCollapse(id)}
        >
          {data.collapsed ? "+" : "−"}
        </button>
      </div>
      <small>
        {data.count} declarations{data.collapsed ? " · collapsed" : ""}
      </small>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
