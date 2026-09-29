import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Bundle } from "./bundle.js";
import { createServer } from "./server.js";

// Config: OKF_BUNDLE_PATH (required), OKF_TRANSPORT=stdio|http (default http), PORT (default 3000).
const bundlePath = process.env.OKF_BUNDLE_PATH;
if (!bundlePath) {
  console.error("OKF_BUNDLE_PATH is required");
  process.exit(1);
}
const bundle = new Bundle(path.resolve(bundlePath));
await bundle.load();
console.error(`Loaded ${bundle.concepts.size} concepts`);

if ((process.env.OKF_TRANSPORT ?? "http") === "stdio") {
  await createServer(bundle).connect(new StdioServerTransport());
} else {
  const port = Number(process.env.PORT ?? 3000);
  createHttpServer(async (req, res) => {
    if (req.url === "/healthz") return void res.writeHead(200).end("ok");
    if (req.url !== "/mcp") return void res.writeHead(404).end();
    // Stateless: a fresh server + transport per request.
    const server = createServer(bundle);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void server.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }).listen(port, () => console.error(`OKF MCP server listening on :${port}/mcp`));
}
