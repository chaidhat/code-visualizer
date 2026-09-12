"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
export type DeclarationData = {
  label: string;
  kind: string;
  owner?: string;
  file: string;
  pinned: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  onPin: (id: string) => void;
  onCollapse: (id: string) => void;
};
export default memo(function DeclarationNode({
  id,
  data,
  selected,
}: NodeProps<Node<DeclarationData>>) {
  return (
    <div
      className={`declaration ${selected ? "selected" : ""} ${data.kind === "unresolved" ? "uncertain" : ""}`}
      title={`${data.file}${data.owner ? ` · ${data.owner}` : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <span className="kind">
        {data.kind === "unresolved"
          ? "?"
          : data.kind === "function"
            ? "ƒ"
            : data.kind === "method"
              ? "ƒ"
              : data.kind === "class"
                ? "C"
                : "○"}
      </span>
      <span className="declaration-label">
        {data.label}
        {data.pinned && <small>{data.file}</small>}
      </span>
      {data.hasChildren && (
        <button
          className="nodrag"
          aria-label={`Toggle members of ${data.label}`}
          onClick={() => data.onCollapse(id)}
        >
          {data.collapsed ? "+" : "−"}
        </button>
      )}
      <button
        className="nodrag pin"
        aria-label={`${data.pinned ? "Unpin" : "Pin"} ${data.label}`}
        onClick={() => data.onPin(id)}
      >
        {data.pinned ? "●" : "◇"}
      </button>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
