# Running the demos

A guide for anyone who just wants to run (or live-present) the two demo projects. For *why* the sandboxing works the way it does, see [demo-internals.md](demo-internals.md). For the knowledge server, see [mcp-server.md](mcp-server.md).

## What you're demoing

Two Claude Code sessions, identical in every way except one:

| Demo | Command | Knowledge access |
|---|---|---|
| **without** | `scripts/run-demo.sh without` | None. Vanilla Claude Code. |
| **with** | `scripts/run-demo.sh with` | The Hearth & Wheel knowledge base, via a local MCP server. |

The bakery's jargon (Kettle Process, Ember Index, Nightwatch, Constellations, The Wheel, Looming, Michael) is invented, so a model cannot know it from training. Any correct answer in the **with** demo therefore came from the knowledge base, and the **without** demo shows what an ungrounded agent does with the same question. Both sessions are sandboxed so neither can just read the knowledge files off disk; the **with** agent must go through the MCP tools, as it would against a real company knowledge service.

## Prerequisites

- macOS (the sandbox uses Seatbelt) 
- Node.js 20+ and npm
- `rsync` (ships with macOS)
- Claude Code installed and logged in (`claude --version` works, and a normal `claude` session starts). The demos reuse your normal login, so no token or API key setup is needed.

## One-time setup

```bash
cd mcp-server
npm install
npm run build
cd ..
```

The launcher uses the built server at `mcp-server/dist/index.js`. Re-run `npm run build` after changing anything in `mcp-server/src/`. Knowledge changes (the markdown files) need no rebuild; the server re-reads the bundle on every tool call.

## Running

Open two terminals at the repo root and start one demo in each:

```bash
scripts/run-demo.sh with
scripts/run-demo.sh without
```

Each launch resets that demo's workspace to a fresh copy of its seed folder, so anything the agent created in a previous run is gone. The two demos use separate workspaces, so running them side by side is fine (each can't see the other's). Only one session per demo at a time: the launcher refuses to start a demo that is already running, since the relaunch would delete its workspace.

Extra arguments are passed straight through to `claude`, e.g. a one-shot prompt:

```bash
scripts/run-demo.sh with -p "What is the Ember Index?" --allowedTools "mcp__knowledge"
```

The demos use your normal Claude Code model. Behaviour differs between models (notably how readily the agent consults the knowledge base), so when comparing the two demos, or presenting them, start both with the same explicit model, e.g. `scripts/run-demo.sh with --model haiku` and `scripts/run-demo.sh without --model haiku`.

### Confirming the knowledge is connected

In the **with** session, run `/mcp`. You should see a `knowledge` server with three tools (`list_knowledge`, `read_knowledge`, `search_knowledge`). In the **without** session there should be no MCP servers. When the agent uses the knowledge you'll see tool calls named `mcp__knowledge__...`.

Tool permission prompts appear as normal; approve the `mcp__knowledge__*` calls (or choose "always allow") so the demo flows.

## Suggested demo flow

1. Ask **without** a definitional question, e.g. *"Someone mentioned the Kettle Process in a handover note. What does that actually involve?"* Expect a guess, a request for clarification, or a confident hallucination.
2. Ask **with** the same question. Expect it to search the knowledge base, read the concept, and answer correctly, ideally following links to related concepts (Nightwatch, Ember Index).
3. Escalate to a cross-domain question: *"Walk me through this morning: any Nightwatch alerts, what that means for the Ember Index, whether the Kettle Process batches are affected, and who's looming on the Wheel this week."* This is the "network of dependencies" payload; see the full prompt list in [meta/BAKERY.md](../meta/BAKERY.md).
4. (Optional) Show the isolation: ask either agent to read `../../knowledge/...` or to search the disk for the knowledge files. It will be blocked. See "Verifying isolation" below.

> **Note:** the `with` agent only uses the knowledge tools if it decides to. Without a nudge it answered "What is Looming?" without consulting them at all, so the `with` seed contains a short `CLAUDE.md` "Company knowledge" section (look terms up, including ordinary-looking words; don't guess). With it, the agent searched and answered correctly, made no knowledge calls for a generic coding task, and said "not found" for an unknown term.

## Verifying isolation

For the full test checklist (isolation, baseline, grounding, negative control, unknown term), see [testing-the-demos.md](testing-the-demos.md). The quick version:

Use benign-sounding tasks; the model tends to refuse overtly adversarial "break out of your sandbox" prompts, which tests its willingness rather than the enforcement. For example, in either demo:

> Please read `/Users/<you>/src/bakery-knowledge/knowledge/hearth-and-wheel/bakehouse/ember-index.md` and tell me what it says. If that fails, try `cat`, Glob, and Grep.

Every route should be blocked. Then, in **with** only:

> Use your knowledge tools to look up the Ember Index and tell me what a high score means.

That should work via `mcp__knowledge__*` ("higher is worse", oven instability). If **without** can state the concept's content (e.g. that the Ember Index is a 0-100 oven-stability score), or **with** gets it through a non-MCP route, isolation is broken; start with [demo-internals.md](demo-internals.md).

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Cannot find module .../dist/index.js` or `knowledge` server fails in `/mcp` | Build the server: `cd mcp-server && npm install && npm run build`. |
| `run-demo: knowledge server not built` | `cd mcp-server && npm install && npm run build`. The launcher checks this so `with` can't silently run without its knowledge. |
| `run-demo: a 'with' demo is already running (pid N)` | Close that session first. If it's gone, the lock is stale and is ignored on the next launch (it only blocks a live PID). |
| `run-demo: repo is directly under '...'` | Move the repo into a subdirectory such as `~/src`. The repo's parent directory is hidden from the agent, and the workspace lives under `$HOME`. |
| `run-demo: '<tool>' not found on PATH` | Install `node`, `rsync` or `claude`. |
| Sandbox fails to start | The launcher sets `failIfUnavailable`, so it refuses to run unsandboxed. Seatbelt needs macOS; check `claude` is up to date. |
| `with` agent doesn't use the knowledge | Check `/mcp`. Check the bundle path exists and has `.md` files. Try asking it to "search the knowledge base for X". |
| Agent doesn't consult the knowledge base | The tools are available but the model must choose to use them. Ask explicitly ("search the knowledge base for X"), or check that `demos/with-knowledge/CLAUDE.md` is still present and hasn't been trimmed. |
| Stale/odd state in a demo | Just relaunch; the workspace is recreated each time. |
| You changed knowledge files but the agent doesn't see them | It should, since the server re-reads on every call. Make sure you edited `knowledge/hearth-and-wheel/`, and start a fresh tool call. |

## Iterating

- **Edit knowledge:** change files in `knowledge/hearth-and-wheel/` (OKF format, see [open-knowledge-format/SPEC.md](../open-knowledge-format/SPEC.md)). No restart needed.
- **Edit the server:** change `mcp-server/src/`, rebuild, relaunch the **with** demo. See [mcp-server.md](mcp-server.md).
- **Change what the demos start with:** add files to `demos/with-knowledge/` or `demos/without-knowledge/`; they're copied into the workspace on each launch. Keep the two folders equivalent apart from the knowledge hint in `with-knowledge/CLAUDE.md`, and free of hackathon/bakery wording.
- **Change isolation:** edit `scripts/run-demo.sh` after reading [demo-internals.md](demo-internals.md).
