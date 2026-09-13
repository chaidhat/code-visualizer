import { memo, useEffect, useMemo, useState } from "react";
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
}: {
  text: string;
  selected: boolean;
  origin: boolean;
  segments?: ReturnType<typeof sourceSegments>;
  name?: string;
  pathText?: string;
  bold?: boolean;
  accepted?: boolean;
}) {
  return (
    <Text inverse={name === undefined && selected} wrap="truncate-end">
      {name !== undefined ? (
        <>
          <Text
            bold={bold}
            inverse={selected}
            backgroundColor={origin ? "yellow" : undefined}
            color={accepted ? "#999999" : origin ? "black" : undefined}
            dimColor={accepted}
          >
            {name}
          </Text>
          <Text color="#999999" dimColor>
            {pathText}
          </Text>
        </>
      ) : segments ? (
        segments.map((segment, index) => (
          <Text key={index} color={segment.highlighted ? "red" : undefined}>
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
}: {
  snapshot: Snapshot;
  initialHierarchyTarget: string;
  onInterrupt?: () => void;
  acceptanceDirectory?: string;
}) {
  const [acceptance] = useState(
    () => new Acceptance(snapshot, acceptanceDirectory),
  );
  const [, refreshAcceptance] = useState(0);
  const [acceptanceMessage, setAcceptanceMessage] = useState(
    acceptance.warning,
  );
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
  const rows = useMemo(
    () =>
      page.target
        ? sourceRows(snapshot, page.target)
        : fileHierarchy(snapshot, initial.file, initial.id),
    [snapshot, page.target, initial.file, initial.id],
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
  useInput((input, key) => {
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
          setAcceptanceMessage(accepted ? "Accepted" : "Acceptance removed");
        } catch (error) {
          setAcceptanceMessage(
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
      if (target)
        setPages((previous) => [
          ...previous,
          { target, cursor: 0, horizontal: 0, top: 0 },
        ]);
      return;
    }
    setPages((previous) => {
      const current = previous[previous.length - 1];
      let cursor = current.cursor;
      let horizontal = current.horizontal;
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
      cursor = Math.max(0, Math.min(rows.length - 1, cursor));
      const top = visibleStart(cursor, current.top, height, rows.length);
      if (
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
          ? "j/k scroll  y accept/undo  h back  q quit"
          : "j/k move  g jump  l open  y accept/undo  q quit"}
      </Text>
      <Box flexDirection="column" height={height}>
        {rows.slice(start, start + height).map((row, index) => (
          <VisibleRow
            key={index}
            selected={start + index === page.cursor}
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
        {acceptanceMessage ??
          `${page.cursor + 1}/${rows.length}  ${snapshot.files.length} files${snapshot.analysis ? `, ${snapshot.analysis.reusedFiles} reused` : ""}  ${snapshot.warnings.length} warnings  Keep files unchanged, restart after edits`}
      </Text>
    </Box>
  );
}
