# The OKF MCP server

`mcp-server/` is a small, general-purpose [MCP](https://modelcontextprotocol.io) server that serves any [Open Knowledge Format](../open-knowledge-format/SPEC.md) bundle to an agent. Nothing in it is bakery-specific; point it at a different bundle and it serves that instead. For how it's wired into the demos, see [demo-internals.md](demo-internals.md).

## Running it

```bash
cd mcp-server
npm install
npm run build

# stdio (how the demos use it; Claude Code launches it as a child process)
OKF_BUNDLE_PATH=../knowledge/hearth-and-wheel OKF_TRANSPORT=stdio node dist/index.js

# HTTP (handy for poking with curl)
OKF_BUNDLE_PATH=../knowledge/hearth-and-wheel PORT=3000 node dist/index.js
```

`npm run dev` runs from source with `tsx`.

### Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `OKF_BUNDLE_PATH` | *(required)* | Directory of the OKF bundle (its root). |
| `OKF_TRANSPORT` | `http` | `stdio` or `http`. Any other value is an error (it does not fall back to http). |
| `PORT` | `3000` | HTTP transport only. An integer 0-65535; `0` picks a free port (the startup line on stderr shows which). |
| `OKF_HOST` | `127.0.0.1` | HTTP transport only. The interface to bind. There is no authentication, so only widen this on a network you trust. |

Invalid configuration exits with status 1 and a message on stderr. All logging goes to stderr, because stdout carries the protocol in stdio mode.

On HTTP: `POST /mcp` is the MCP endpoint (stateless Streamable HTTP; a fresh server per request, so no sessions, no SSE stream and no `DELETE`) and `GET /healthz` returns `ok`. Paths are matched ignoring any query string. Other methods on these paths get `405` (with an `Allow` header), unknown paths get `404`, malformed JSON gets `400`, and an unexpected error in a request is logged and returns `500` without stopping the server.

Trying it by hand over HTTP:

```bash
curl -s localhost:3000/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_knowledge","arguments":{"query":"secret"}}}'
```

## How it reads the bundle

- Recursively reads every `.md` file under `OKF_BUNDLE_PATH`, except inside hidden directories (`.git`, ...) and `node_modules`. Symlinks are not followed, so nothing outside the bundle root can be served.
- `index.md` and `log.md` are **reserved** (OKF §3.1) at any depth: indexes are kept for directory browsing, `log.md` is not served as a concept. Every other `.md` file is a **concept**.
- **Concept ID** = path relative to the bundle root, without `.md` (e.g. `bakehouse/ember-index`).
- YAML frontmatter is parsed leniently: unparseable frontmatter, or frontmatter that isn't a key/value mapping, yields an empty metadata object rather than an error (OKF requires consumers to be tolerant). An empty block (`---` directly followed by `---`) is valid frontmatter. LF and CRLF line endings both work. The body is everything after the frontmatter.
- **Links** are extracted from markdown links to `.md` files in the body (absolute `/x/y.md` and relative `./y.md` or `../y.md` forms, with an optional `#anchor` and optional `"title"`). Percent-encoding is decoded (`my%20file.md`). External URLs and links that would leave the bundle are ignored, and so are links written inside fenced code blocks or inline code, since those are examples and not relationships. Links to concepts that don't exist yet are kept and flagged as "not yet written".
- The bundle is **re-read on every tool call**, so edits to the markdown appear immediately with no restart.

It does not currently interpret the OKF trust/lifecycle fields (`verified`, `status`, `stale_after`, `sources`, attested computations); it just returns frontmatter verbatim in `read_knowledge`, so the agent can see them.

## Tools

There are three tools, designed for progressive disclosure: browse, search, then read.

### `list_knowledge`

Browse the knowledge base.

- **Input:** `directory` (optional string): a directory within the bundle, e.g. `finance`. Omit for the root.
- **Returns:** the raw text of that directory's `index.md` (or a note that there isn't one), followed by a `## Concepts` list of every concept under that directory, one line each: `- <id> [<type>] — <title>: <description>`. Note that the concept list includes concepts in subdirectories.
- **Errors:** an error result if nothing exists under the directory.
- **Use:** start here to discover what exists.

### `search_knowledge`

Keyword search across the bundle.

- **Input:** `query` (string; whitespace-separated terms), `limit` (optional integer 1–50, default 10).
- **Returns:** matching concepts as `- <id> [<type>] — <title>: <description>`, best first, or a "no match" message.
- **Ranking:** simple and deterministic. Per term: +5 if in the title or ID, +3 if in the description or tags, +1 if in the body (case-insensitive substring). Ties break alphabetically by ID. No stemming, no semantic search.
- **Use:** for a term or name the agent doesn't recognise.

### `read_knowledge`

Read one concept in full.

- **Input:** `id` (string): the concept ID; a leading `/` and trailing `.md` are tolerated.
- **Returns:** a document with the title, the frontmatter as JSON (`## Metadata`), the markdown body (`## Content`), the concepts it links to (`## Links to`, flagging unwritten targets), and the concepts that link to it (`## Linked from`).
- **Errors:** an error result suggesting search/list if the ID doesn't exist.
- **Use:** to get the actual definition. The link sections let the agent walk the graph, which is where cross-domain relationships come from.

## Source layout

| File | Role |
|---|---|
| `src/index.ts` | Entry point: reads env config, loads the bundle, starts stdio or HTTP transport. |
| `src/server.ts` | Defines the three tools (`createServer`). |
| `src/bundle.ts` | Bundle loading, frontmatter/link parsing (`parseConcept`), backlinks, and search scoring. |
| `src/bundle.test.ts` | Unit tests: frontmatter edge cases, link extraction, directory walking, search ranking. |
| `src/server.test.ts` | Runs the built server as a subprocess: configuration errors and the HTTP behaviour above. |

## Testing

```bash
cd mcp-server
npm test        # compiles, then runs the tests with Node's built-in runner (no extra dependencies)
```

Each test that covers a fixed bug fails against the earlier code, so a regression in parsing, routing or config validation shows up here. The demos' end-to-end behaviour (what an agent does with the tools) is covered separately in [testing-the-demos.md](testing-the-demos.md).

## Extending it

- **New tool:** add a `server.registerTool(...)` in `src/server.ts`. Call `await bundle.load()` first so results are fresh. Keep descriptions domain-neutral: tool descriptions are visible to the agent, and this server is meant to be general purpose.
- **Better search:** replace `Bundle.search` in `src/bundle.ts` (e.g. add stemming or embeddings) without changing the tool contract.
- **Use trust fields:** `Bundle` exposes parsed frontmatter, so surfacing a derived trust tier (OKF §5.3) or staleness (`stale_after`) is a small change in `read_knowledge`.
- After any change: `npm test` (it builds too), then relaunch the **with** demo.
