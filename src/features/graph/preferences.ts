import { z } from "zod";
import type { Graph } from "@/shared/graph";
export const preferencesSchema = z.object({
  positions: z.record(
    z.string(),
    z.object({ x: z.number().finite(), y: z.number().finite() }),
  ),
  pins: z.array(z.string()).max(10000),
  collapsed: z.array(z.string()).max(30000),
  focus: z.boolean(),
  steps: z.number().int().min(1).max(4),
  external: z.boolean(),
  uncertain: z.boolean(),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaults: Preferences = {
  positions: {},
  pins: [],
  collapsed: [],
  focus: false,
  steps: 1,
  external: true,
  uncertain: true,
};
export function reconcilePreferences(
  prefs: Preferences,
  graph: Graph,
): Preferences {
  const valid = new Set([
    ...graph.files.map((f) => f.id),
    "External",
    ...graph.declarations.map((d) => d.id),
  ]);
  const identities = new Map<string, string[]>();
  for (const d of graph.declarations) {
    const identity = d.id.replace(/#\d+$/, "");
    const list = identities.get(identity) ?? [];
    list.push(d.id);
    identities.set(identity, list);
  }
  // Repeated declarations cannot safely inherit another occurrence's saved position.
  for (const ids of identities.values())
    if (ids.length > 1) for (const id of ids) valid.delete(id);
  return {
    ...prefs,
    positions: Object.fromEntries(
      Object.entries(prefs.positions).filter(([id]) => valid.has(id)),
    ),
    pins: prefs.pins.filter((id) => valid.has(id)),
    collapsed: prefs.collapsed.filter((id) => valid.has(id)),
  };
}
