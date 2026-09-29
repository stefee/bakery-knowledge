import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Bundle, type Concept } from "./bundle.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ ...text(t), isError: true });

function summary(c: Concept): string {
  const fm = c.frontmatter;
  const title = fm.title ? ` — ${fm.title}` : "";
  const desc = fm.description ? `: ${fm.description}` : "";
  return `- ${c.id} [${fm.type ?? "?"}]${title}${desc}`;
}

export function createServer(bundle: Bundle, name = "okf-knowledge"): McpServer {
  const server = new McpServer({ name, version: "0.1.0" });

  server.registerTool(
    "list_knowledge",
    {
      description:
        "Browse the organisation's knowledge base. Returns the index for a directory (or the root) followed by every concept under it, including those in subdirectories. Start here to discover what knowledge exists.",
      inputSchema: {
        directory: z.string().optional().describe("Directory to list, e.g. 'finance'. Omit for the root."),
      },
    },
    async ({ directory }) => {
      await bundle.load();
      const dir = (directory ?? "").replace(/^\/+|\/+$/g, "");
      const prefix = dir ? `${dir}/` : "";
      const inDir = [...bundle.concepts.values()].filter((c) => c.id.startsWith(prefix));
      if (inDir.length === 0 && !bundle.indexes.has(dir)) return fail(`No knowledge found under '${dir}'.`);
      const index = bundle.indexes.get(dir);
      return text([index ?? "(no index.md in this directory)", "", "## Concepts", ...inDir.map(summary)].join("\n"));
    },
  );

  server.registerTool(
    "read_knowledge",
    {
      description:
        "Read one concept from the knowledge base by its ID (the path shown by list_knowledge/search_knowledge, without .md). Returns its metadata, full content, and the concepts it links to.",
      inputSchema: { id: z.string().describe("Concept ID, e.g. 'finance/revenue'.") },
    },
    async ({ id }) => {
      await bundle.load();
      const clean = id.replace(/^\/+/, "").replace(/\.md$/, "");
      const c = bundle.concepts.get(clean);
      if (!c) return fail(`No concept with ID '${clean}'. Try search_knowledge or list_knowledge.`);
      const linksOut = c.links.map((l) => `- ${l}${bundle.concepts.has(l) ? "" : " (not yet written)"}`);
      const linksIn = bundle.backlinks(c.id).map((l) => `- ${l}`);
      return text(
        [
          `# ${c.frontmatter.title ?? c.id}`,
          "",
          "## Metadata",
          JSON.stringify(c.frontmatter, null, 2),
          "",
          "## Content",
          c.body.trim(),
          "",
          "## Links to",
          ...(linksOut.length ? linksOut : ["(none)"]),
          "",
          "## Linked from",
          ...(linksIn.length ? linksIn : ["(none)"]),
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "search_knowledge",
    {
      description:
        "Keyword search across the knowledge base (titles, descriptions, tags, content). Use for terms, names, or jargon you don't recognise.",
      inputSchema: {
        query: z.string().describe("Words to look for."),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum number of results (default 10)."),
      },
    },
    async ({ query, limit }) => {
      await bundle.load();
      const hits = bundle.search(query, limit ?? 10);
      if (hits.length === 0) return text(`No knowledge matched '${query}'.`);
      return text(hits.map((h) => summary(h.concept)).join("\n"));
    },
  );

  return server;
}
