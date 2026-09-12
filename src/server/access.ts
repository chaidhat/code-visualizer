import { timingSafeEqual } from "node:crypto";
export function validateLocal(request: Request, requireToken = true) {
  const host = request.headers.get("host") ?? "";
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
    throw new Error("Access denied");
  const origin = request.headers.get("origin");
  if (origin && origin !== `http://${host}`) throw new Error("Access denied");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    throw new Error("Access denied");
  if (requireToken) {
    const expected = process.env.VISUALIZER_TOKEN;
    const supplied = request.headers.get("x-local-session") ?? "";
    if (
      !expected ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    )
      throw new Error("Access denied");
  }
}
