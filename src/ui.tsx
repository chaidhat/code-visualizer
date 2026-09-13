import { resolve } from "node:path";
import clipboard from "clipboardy";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { Acceptance } from "./acceptance.js";
import { fileHierarchy } from "./hierarchy.js";
import type { Snapshot } from "./model.js";
import { label, safeText, sourceRows, sourceSegments } from "./display.js";

interface Page {
  target?: string;
  cursor: number;
  horizontal: number;
  top: number;
  mention?: number;
}

function visibleStart(
  cursor: number,
  top: number,
  height: number,
  count: number,
): number {
  const visible =
    cursor < top ? cursor : cursor >= top + height ? cursor - height + 1 : top;
  return Math.max(0, Math.min(visible, count - height));
}

const VisibleRow = memo(function VisibleRow({
  text,
  selected,
  origin,
  name,
  pathText,
  bold,
  segments,
  accepted,
  mention,
}: {
  text: string;
  selected: boolean;
  origin: boolean;
  segments?: ReturnType<typeof sourceSegments>;
  name?: string;
  pathText?: string;
  bold?: boolean;
  accepted?: boolean;
  mention?: number;
}) {
  return (
    <Text
      inverse={name === undefined && selected && !segments}
      wrap="truncate-end"
    >
      {name !== undefined ? (
        <>
          <Text
            bold={bold}
            inverse={selected}
            backgroundColor={origin ? "blue" : undefined}
            color={origin ? "white" : accepted ? "green" : undefined}
          >
            {name}
          </Text>
          <Text color="#999999" dimColor>
            {pathText}
          </Text>
        </>
      ) : segments ? (
        segments.map((segment, index) => (
          <Text
            key={index}
            color={
              segment.child
                ? "white"
                : segment.highlighted
                  ? "red"
                  : segment.color
            }
            backgroundColor={
              segment.child
                ? selected && mention === segment.start
                  ? "blue"
                  : "#555555"
                : undefined
            }
            inverse={selected && mention === undefined}
          >
            {segment.text}
          </Text>
        ))
      ) : (
        text || " "
      )}
    </Text>
  );
});

export function Explorer({
  snapshot,
  initialHierarchyTarget,
  onInterrupt,
  acceptanceDirectory,
  copyText = clipboard.write,
}: {
  snapshot: Snapshot;
  initialHierarchyTarget: string;
  onInterrupt?: () => void;
  acceptanceDirectory?: string;
  copyText?: (text: string) => Promise<void>;
}) {
  const [acceptance] = useState(
    () => new Acceptance(snapshot, acceptanceDirectory),
  );
  const [, refreshAcceptance] = useState(0);
  const [statusMessage, setStatusMessage] = useState(acceptance.warning);
  const copying = useRef(false);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    rows: stdout.rows || 24,
    columns: stdout.columns || 80,
  });
  const initial = snapshot.declarations.get(initialHierarchyTarget);
  if (!initial) throw new Error("Hierarchy target unavailable.");
  const [pages, setPages] = useState<Page[]>([
    { cursor: 0, horizontal: 0, top: 0 },
  ]);
  const page = pages[pages.length - 1];
  const hierarchy = useMemo(
    () => fileHierarchy(snapshot, initial.file, initial.id),
    [snapshot, initial.file, initial.id],
  );
  const visibleTargets = useMemo(
    () => new Set(hierarchy.flatMap((row) => (row.target ? [row.target] : []))),
    [hierarchy],
  );
  const rows = useMemo(
    () =>
      page.target
        ? sourceRows(snapshot, page.target, visibleTargets)
        : hierarchy,
    [snapshot, page.target, hierarchy, visibleTargets],
  );
  const mentions = useMemo(
    () =>
      rows.flatMap((row, rowIndex) =>
        (row.children ?? []).map((span) => ({ row: rowIndex, ...span })),
      ),
    [rows],
  );
  const mentionIndex = mentions.findIndex(
    (span) => span.row === page.cursor && span.start === page.mention,
  );
  const height = Math.max(1, size.rows - 4);
  const start = visibleStart(page.cursor, page.top, height, rows.length);
  useEffect(() => {
    setPages((previous) => {
      const current = previous[previous.length - 1];
      const top = visibleStart(
        current.cursor,
        current.top,
        height,
        rows.length,
      );
      return top === current.top
        ? previous
        : [...previous.slice(0, -1), { ...current, top }];
    });
  }, [height, rows.length]);
  useEffect(() => {
    const resize = () =>
      setSize({ rows: stdout.rows || 24, columns: stdout.columns || 80 });
    stdout.on("resize", resize);
    return () => {
      stdout.off("resize", resize);
    };
  }, [stdout]);
  const copySelectedPath = async () => {
    if (copying.current) return;
    const target = rows[page.cursor]?.target;
    const selected = target ? snapshot.declarations.get(target) : undefined;
    if (!selected) {
      setStatusMessage("No file path on this row.");
      return;
    }
    copying.current = true;
    setStatusMessage("Copying file path…");
    try {
      await copyText(resolve(snapshot.root, selected.file));
      setStatusMessage("File path copied.");
    } catch {
      setStatusMessage(
        "Could not copy file path. Check that your clipboard is available and try again.",
      );
    } finally {
      copying.current = false;
    }
  };
  useInput((input, key) => {
    if (key.super && input === "c" && !key.ctrl && !key.meta && !key.shift) {
      if (!page.target) void copySelectedPath();
      return;
    }
    if (key.ctrl && input === "c") {
      onInterrupt?.();
      exit();
      return;
    }
    if (input === "y" && !key.ctrl && !key.meta) {
      const target = page.target ?? rows[page.cursor]?.target;
      if (target) {
        try {
          const accepted = acceptance.toggle(target);
          refreshAcceptance((value) => value + 1);
          setStatusMessage(accepted ? "Accepted" : "Acceptance removed");
        } catch (error) {
          setStatusMessage(
            `Could not save acceptance: ${safeText(error instanceof Error ? error.message : String(error))}`,
          );
        }
      }
      return;
    }
    if (input === "q") {
      exit();
      return;
    }
    if (input === "h" || key.escape || (key.leftArrow && !page.target)) {
      setPages((previous) =>
        previous.length > 1 ? previous.slice(0, -1) : previous,
      );
      return;
    }
    if (!page.target && (input === "l" || key.return || key.rightArrow)) {
      const target = rows[page.cursor]?.target;
      if (target) {
        const source = sourceRows(snapshot, target, visibleTargets);
        const first = source.findIndex((row) => row.children?.length);
        const cursor = Math.max(0, first);
        const mention = source[cursor]?.children?.[0]?.start;
        setPages((previous) => [
          ...previous,
          {
            target,
            cursor,
            mention,
            horizontal:
              mention !== undefined && mention >= size.columns
                ? Math.max(0, mention - 10)
                : 0,
            top: Math.max(0, cursor - Math.floor(height / 2)),
          },
        ]);
      }
      return;
    }
    setPages((previous) => {
      const current = previous[previous.length - 1];
      let cursor = current.cursor;
      let horizontal = current.horizontal;
      let mention = current.mention;
      if (
        current.target &&
        (input === "n" || input === "N") &&
        !key.ctrl &&
        !key.meta
      ) {
        const next =
          input === "n"
            ? mentions.find(
                (span) =>
                  span.row > cursor ||
                  (span.row === cursor && span.start > (mention ?? -1)),
              )
            : mentions
                .slice()
                .reverse()
                .find(
                  (span) =>
                    span.row < cursor ||
                    (span.row === cursor && span.start < (mention ?? Infinity)),
                );
        if (next) {
          cursor = next.row;
          mention = next.start;
          if (next.start < horizontal || next.end > horizontal + size.columns)
            horizontal = Math.max(0, next.start - 10);
        }
      }
      if (key.downArrow || input === "j") cursor++;
      if (key.upArrow || input === "k") cursor--;
      if (key.pageDown || (key.ctrl && input === "d")) cursor += height;
      if (key.pageUp || (key.ctrl && input === "u")) cursor -= height;
      if (input === "g") cursor = rows[current.cursor]?.aboveRow ?? 0;
      if (key.home) cursor = 0;
      if (input === "G" || key.end) cursor = rows.length - 1;
      if (current.target && key.rightArrow) horizontal += 20;
      if (current.target && key.leftArrow)
        horizontal = Math.max(0, horizontal - 20);
      if (input !== "n" && input !== "N" && cursor !== current.cursor)
        mention = undefined;
      cursor = Math.max(0, Math.min(rows.length - 1, cursor));
      const top = visibleStart(cursor, current.top, height, rows.length);
      if (
        mention === current.mention &&
        cursor === current.cursor &&
        horizontal === current.horizontal &&
        top === current.top
      )
        return previous;
      return [
        ...previous.slice(0, -1),
        {
          ...current,
          cursor,
          mention,
          top,
          horizontal,
        },
      ];
    });
  });
  const declaration = page.target
    ? snapshot.declarations.get(page.target)
    : undefined;
  const title = declaration
    ? `${declaration.file}:${declaration.line}  ${label(declaration)}`
    : `File hierarchy  ${initial.file}`;
  return (
    <Box flexDirection="column" width={size.columns}>
      <Text wrap="truncate-end" color="cyan">
        {safeText(title)}
      </Text>
      <Text wrap="truncate-end" dimColor>
        {page.target
          ? "j/k scroll  n/N child  y accept/undo  h back  q quit"
          : "j/k move  g jump  l open  Cmd+C copy path  y accept/undo  q quit"}
      </Text>
      <Box flexDirection="column" height={height}>
        {rows.slice(start, start + height).map((row, index) => (
          <VisibleRow
            key={index}
            selected={start + index === page.cursor}
            mention={page.mention}
            origin={start + index === rows[page.cursor]?.aboveRow}
            name={row.name}
            pathText={row.pathText}
            bold={row.bold}
            accepted={
              row.target !== undefined && acceptance.accepted.has(row.target)
            }
            segments={
              page.target ? sourceSegments(row, page.horizontal) : undefined
            }
            text={page.horizontal ? row.text.slice(page.horizontal) : row.text}
          />
        ))}
      </Box>
      <Text wrap="truncate-end" dimColor>
        {statusMessage ??
          `${page.cursor + 1}/${rows.length}  ${page.target && mentions.length ? `Child ${mentionIndex + 1}/${mentions.length}  ` : ""}${snapshot.files.length} files${snapshot.analysis ? `, ${snapshot.analysis.reusedFiles} reused` : ""}  ${snapshot.warnings.length} warnings  Keep files unchanged, restart after edits`}
      </Text>
    </Box>
  );
}
