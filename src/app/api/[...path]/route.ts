import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { readSmallJson } from "@/server/requestBody";
import { validateLocal } from "@/server/access";
import {
  createProject,
  getProject,
  status,
  cancel,
  sourceSnippet,
} from "@/server/jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
let launch: Promise<unknown> = Promise.resolve();
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    validateLocal(request, false);
    const segments = (await context.params).path;
    if (
      segments.length === 1 &&
      segments[0] === "session" &&
      request.method === "GET"
    ) {
      if (!process.env.VISUALIZER_TOKEN)
        return json(
          { error: "Start the app using npm run dev or npm start." },
          503,
        );
      return json({ token: process.env.VISUALIZER_TOKEN });
    }
    validateLocal(request);
    const url = new URL(request.url);
    if (
      segments[0] === "directories" &&
      segments.length === 1 &&
      request.method === "GET"
    ) {
      const target = url.searchParams.get("path") || os.homedir();
      if (!path.isAbsolute(target))
        return json({ error: "Enter an absolute folder path." }, 400);
      const actual = await fs.realpath(target);
      const entries = await fs.readdir(actual, { withFileTypes: true });
      return json({
        path: actual,
        parent: path.dirname(actual),
        directories: entries
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .map((e) => e.name)
          .sort()
          .slice(0, 1000),
      });
    }
    if (
      segments[0] === "projects" &&
      segments.length === 1 &&
      request.method === "POST"
    ) {
      if (Number(request.headers.get("content-length")) > 8192)
        return json({ error: "Request too large." }, 413);
      const raw = await readSmallJson(request);
      const { root } = z
        .object({ root: z.string().min(1).max(4096) })
        .parse(raw);
      const next = launch.then(() => createProject(root));
      launch = next.catch(() => {});
      return json(await next);
    }
    if (segments[0] === "projects" && segments[1]) {
      const id = segments[1];
      if (segments.length === 2 && request.method === "GET")
        return json(status(getProject(id)));
      if (segments.length === 2 && request.method === "DELETE")
        return json(await cancel(id));
      if (segments[2] === "graph" && request.method === "GET") {
        const graph = getProject(id).graph;
        if (!graph) return json({ error: "Snapshot is not ready." }, 409);
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .parse(url.searchParams.get("offset") ?? 0);
        return json({
          version: graph.version,
          meta:
            offset === 0
              ? {
                  ...graph,
                  connections: [],
                  declarations: [],
                  files: [],
                  incoming: {},
                  outgoing: {},
                }
              : undefined,
          files: graph.files.slice(offset, offset + 1000),
          declarations: graph.declarations.slice(offset, offset + 1000),
          connections: graph.connections.slice(offset, offset + 1000),
          next:
            Math.max(
              graph.files.length,
              graph.declarations.length,
              graph.connections.length,
            ) >
            offset + 1000
              ? offset + 1000
              : null,
        });
      }
      if (segments[2] === "source" && request.method === "GET")
        return json(
          await sourceSnippet(
            id,
            url.searchParams.get("file") ?? "",
            Number(url.searchParams.get("start")),
            Number(url.searchParams.get("end")),
          ),
        );
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    const denied = error instanceof Error && error.message === "Access denied";
    // Filesystem errors can contain private absolute paths. Never send them to the page.
    const message = denied
      ? "Access denied"
      : error instanceof Error &&
          !("code" in error) &&
          !(error instanceof z.ZodError) &&
          !(error instanceof SyntaxError)
        ? error.message
        : "The request could not be completed. Check the folder and try again.";
    return json({ error: message }, denied ? 403 : 400);
  }
}
export { handle as GET, handle as POST, handle as DELETE };
