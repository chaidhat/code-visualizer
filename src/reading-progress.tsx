import { Text, useStdout, useApp, useInput } from "ink";
import type { ReadProgress } from "./model.js";

export function ReadingProgress({
  progress,
  onInterrupt,
}: {
  progress?: ReadProgress;
  onInterrupt?: () => void;
}) {
  const { stdout } = useStdout();
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onInterrupt?.();
      exit();
    }
  });
  if (!progress) return <Text>Finding TypeScript files…</Text>;
  const { read, total } = progress;
  const fraction = total === 0 ? 1 : read / total;
  const label = `${read}/${total} TypeScript files read`;
  const width = Math.max(
    1,
    Math.min(30, (stdout.columns || 80) - label.length - 12),
  );
  const filled = Math.round(fraction * width);
  return (
    <Text wrap="truncate-end">
      {`[${"=".repeat(filled)}${" ".repeat(width - filled)}] ${label}${read === total ? " · Analyzing…" : ""}`}
    </Text>
  );
}
