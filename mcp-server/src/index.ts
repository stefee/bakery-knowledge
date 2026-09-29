import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Bundle } from "./bundle.js";
import { createServer } from "./server.js";

// Config (environment):
//   OKF_BUNDLE_PATH  required  bundle root directory
//   OKF_TRANSPORT    stdio | http (default http)
//   PORT             http only, 0-65535 (default 3000; 0 picks a free port)
//   OKF_HOST         http only, interface to bind (default 127.0.0.1; there is no authentication,
//                    so only widen this on a network you trust)
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const bundlePath = process.env.OKF_BUNDLE_PATH;
if (!bundlePath) fail("OKF_BUNDLE_PATH is required");

const transport = process.env.OKF_TRANSPORT ?? "http";
if (transport !== "stdio" && transport !== "http") {
  fail(`OKF_TRANSPORT must be 'stdio' or 'http' (got '${transport}')`);
}
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  fail(`PORT must be an integer from 0 to 65535 (got '${process.env.PORT}')`);
}
const host = process.env.OKF_HOST ?? "127.0.0.1";

const bundle = new Bundle(path.resolve(bundlePath));
await bundle.load();
console.error(`Loaded ${bundle.concepts.size} concepts`);

if (transport === "stdio") {
  // stdout carries the protocol in stdio mode: log to stderr only.
  await createServer(bundle).connect(new StdioServerTransport());
} else {
  const http = createHttpServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      if (pathname === "/healthz") {
        if (method !== "GET" && method !== "HEAD") return void res.writeHead(405, { Allow: "GET, HEAD" }).end();
        return void res.writeHead(200).end("ok");
      }
      if (pathname !== "/mcp") return void res.writeHead(404).end();
      // Stateless server: no sessions, so only POST is meaningful (no SSE stream, no DELETE).
      if (method !== "POST") return void res.writeHead(405, { Allow: "POST" }).end();
      // Stateless: a fresh server + transport per request.
      const server = createServer(bundle);
      const httpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => void server.close());
      await server.connect(httpTransport);
      await httpTransport.handleRequest(req, res);
    } catch (err) {
      console.error("request failed:", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  http.listen(port, host, () => {
    const addr = http.address() as AddressInfo;
    console.error(`OKF MCP server listening on http://${host}:${addr.port}/mcp`);
  });
}
