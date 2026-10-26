import { getVercelGateway } from "./vercel-app.js";

// Vercel serves every function under /api/...; the gateway only knows /healthz and
// /v1/.... One function per endpoint keeps the caller's query string untouched, so
// only the tile route needs a rewrite (see vercel.json).
const FUNCTION_PREFIX = "/api";
const TILE_PATH = "/v1/map/tiles";

function stripFunctionPrefix(pathname) {
  if (pathname === FUNCTION_PREFIX) return "/";
  if (pathname.startsWith(`${FUNCTION_PREFIX}/`)) return pathname.slice(FUNCTION_PREFIX.length);
  return pathname;
}

/**
 * Rebuild the URL the gateway expects from whatever Vercel hands the function.
 *
 * The tile route arrives as either `/api/v1/map/tiles/15/1/2` (a rewrite that keeps
 * the path) or `/api/v1/map/tiles?z=15&x=1&y=2` (a rewrite that moves the segments).
 * The gateway rejects any query string on the tile route, so both shapes collapse to
 * the same clean path here.
 */
export function logicalRequestUrl(requestUrl) {
  const url = new URL(requestUrl ?? "/", "http://function.internal");
  let pathname = stripFunctionPrefix(url.pathname);

  if (pathname === TILE_PATH) {
    const z = url.searchParams.get("z");
    const x = url.searchParams.get("x");
    const y = url.searchParams.get("y");
    if (z !== null && x !== null && y !== null) {
      pathname = `${TILE_PATH}/${encodeURIComponent(z)}/${encodeURIComponent(x)}/${encodeURIComponent(y)}`;
      for (const key of ["z", "x", "y"]) url.searchParams.delete(key);
    }
  }

  const search = url.searchParams.toString();
  return search === "" ? pathname : `${pathname}?${search}`;
}

function sendUnavailable(response) {
  const body = JSON.stringify({
    protocol_version: 1,
    request_id: null,
    error: {
      code: "SERVER_MISCONFIGURED",
      message: "gateway is unavailable; check deployment configuration",
      retryable: false,
    },
  });
  response.statusCode = 503;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
}

/**
 * Vercel Node function entry point.
 *
 * The request and response are real http.IncomingMessage/http.ServerResponse objects,
 * so the same createGateway() server that backs the long-running Node host can be fed
 * one request without ever listening on a socket.
 */
export async function handle(request, response) {
  let server;
  try {
    ({ server } = getVercelGateway());
  } catch {
    // No raw error text: it could contain a key or an upstream URL.
    if (!response.headersSent) sendUnavailable(response);
    return;
  }

  request.url = logicalRequestUrl(request.url);

  // The invocation must stay alive until the async gateway finishes writing; resolving
  // earlier lets the platform return a truncated response.
  await new Promise((resolve) => {
    response.once("finish", resolve);
    response.once("close", resolve);
    response.once("error", resolve);
    try {
      server.emit("request", request, response);
    } catch {
      if (response.headersSent) {
        if (!response.writableEnded) response.end();
      } else {
        sendUnavailable(response);
      }
      resolve();
    }
  });
}

export default handle;
