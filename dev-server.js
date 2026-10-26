#!/usr/bin/env node
// Local stand-in for Vercel Functions, so the gateway can be exercised before any
// account or domain exists. It mirrors vercel.json: only the tile route is rewritten.
//
//   cp .env.example .env && npm run dev
//   MOTO_PROVIDER=fixture npm run dev
import { createServer } from "node:http";

import { handle } from "./lib/vercel-handler.js";

const TILE = /^\/api\/v1\/map\/tiles\/(\d+)\/(\d+)\/(\d+)$/;
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const tile = TILE.exec(url.pathname);
  if (tile) request.url = `/api/v1/map/tiles?z=${tile[1]}&x=${tile[2]}&y=${tile[3]}`;
  void handle(request, response);
});

server.listen(port, host, () => {
  console.log(`MOTO GPS gateway (Vercel function shape) on http://${host}:${port}/api/healthz`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
