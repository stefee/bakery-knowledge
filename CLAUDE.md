# CLAUDE.md

This repo contains an exploration of Google's [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format).

The full OKF specification is also stored here in this repository: [open-knowledge-format/SPEC.md](open-knowledge-format/SPEC.md).

This is a 2-day hackathon project. The aim of the project is to explore the Open Knowledge Format and test whether it is effective for grounding an agent in business context and business-specific terminology.

## Project Structure

- `meta/` - Files related to the hackathon.
  - `meta/BAKERY.md` - Business Context for AI at Hearth & Wheel Bakery - this file contains the initial proposal for the made up business to be used as input for writing the knowledgebase itself, some rationale for why this business/domains/concepts were chosen, and some prompt examples that rely on the business knowledge.
- `open-knowledge-format/` - Files copied from the `GoogleCloudPlatform/open-knowledge-format` repo on GitHub.
- `knowledge/hearth-and-wheel/` - The OKF bundle (the bakery knowledge itself). Three domain folders (`bakehouse/`, `wholesale-round/`, `shop-and-customer-line/`), 7 concepts, each folder with an `index.md`; root `index.md` (`okf_version`) and `log.md`. Concepts are `generated` by Claude and deliberately carry no `verified`/`sources` (no human review yet; a `sources` entry pointing at `meta/` would leak the hackathon). Uses the `not:` disambiguation key from the upstream `acme_retail` example bundle. Links are bundle-absolute (`/bakehouse/ember-index.md`).
- `.pages.yml` - [Pages CMS](https://pagescms.org) config for editing the OKF bundle in `knowledge/hearth-and-wheel/` per the spec (concept frontmatter fields, reserved `index.md`/`log.md` files). Update it when the bundle path or the spec's fields change. CMS edits land on the `editing` branch; the `open-editing-pr` action (`.github/workflows/open-editing-pr.yml`, dispatched from Pages CMS's Actions page) opens a PR from `editing` into `main` for review.
- `mcp-server/` - General-purpose TypeScript MCP server that serves any OKF bundle (`OKF_BUNDLE_PATH`) over HTTP or stdio. Tools: `list_knowledge`, `read_knowledge`, `search_knowledge`. Run its tests with `cd mcp-server && npm test`.
- `demos/with-knowledge/`, `demos/without-knowledge/` - Seed folders for the two demo Claude Code projects. `with-knowledge/CLAUDE.md` is a deliberately short "Company knowledge" section telling the agent to look up company terms (including ordinary-looking words) in the knowledge base and not to guess; keep it short and free of bakery terms. `without-knowledge/` is empty. They are never run in place; see `scripts/run-demo.sh`. Keep hackathon/bakery-meta wording out of these folders.
- `docs/` - Guides for running the demos, demo sandbox internals, and the MCP server.
- `scripts/run-demo.sh` - Launches a sandboxed demo session (no Docker). Copies the seed into a fresh, neutrally named workspace (`~/.agent-workspaces/{a,b}/project`) outside the repo, generates sandbox settings + MCP config into `~/.claude/.agent-gen/`, and starts `claude` with `--settings`, `--mcp-config`, `--strict-mcp-config`. Only `with` gets the knowledge MCP server (stdio).

## Documentation (read these first)

- [`docs/running-the-demos.md`](docs/running-the-demos.md) - Guide: how to run and present the two demos.
- [`docs/demo-internals.md`](docs/demo-internals.md) - How and why the sandboxing/isolation works; leak vectors and gotchas.
- [`docs/testing-the-demos.md`](docs/testing-the-demos.md) - Checklist for verifying isolation, the no-knowledge baseline, grounding, and judgement (incl. the "Quokka rota" unknown-term test).
- [`docs/mcp-server.md`](docs/mcp-server.md) - The MCP server: config, tools/endpoints, and how it reads a bundle.

Keep these in sync when you change the launcher, the server, or the layout.

## Running the demos

```
cd mcp-server && npm install && npm run build   # once
scripts/run-demo.sh with        # knowledge via MCP only
scripts/run-demo.sh without     # no knowledge
```

## Sandboxing notes (verified empirically, Claude Code 2.1.x)

- `sandbox.filesystem.denyRead` only covers Bash. Read/Grep/Glob need `Read(//abs/path/**)` permission deny rules (Glob/Grep rules are invalid; Read rules cover all file-reading tools).
- Deny rules are shown to the agent, so deny a broad parent (`~/src`) instead of listing repo folders, which would leak names.
- Claude Code lists its own `--settings` file path to the agent, so keep generated config outside the repo.
- Running inside the repo would leak repo names via cwd, git status, and parent CLAUDE.md; hence the neutral workspace copy (each launch resets it).
- Never `export` repo-derived variables in the launcher: the agent's Bash inherits the environment (an earlier version leaked the repo path via `DEMO_ROOT`/`OLDPWD`). `~/.claude.json` is a *sibling* of `~/.claude/`, so denying the directory doesn't cover it. The denied list is documented in `docs/demo-internals.md`.
- MCP servers run unsandboxed; `ps` is blocked for the agent so the command line isn't visible.
- Test isolation by asking benign-looking tasks; the model refuses overtly adversarial "escape the sandbox" prompts, so those don't test enforcement.

## Ground Rules

- Be proactive about reading the `README.md` and other documentation found in this repo, or other relevant documentation elsewhere (use Fetch tool or `gh` CLI).
- Be a good citizen and keep the `CLAUDE.md` up to date with regards to the high level project structure - future agents will thank you.
- Be collaborative with the user - I (the user) am here with you and I'm available to answer questions. Keep me in the loop.
- Don't push commits up to GitHub without my approval.
