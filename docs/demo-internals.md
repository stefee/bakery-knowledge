# Demo internals: how the sandboxing works and why

Audience: a developer or agent who needs to change, debug, or trust the demo setup. To simply run the demos, read [running-the-demos.md](running-the-demos.md).

## Goal and threat model

The point of the demo is to show an agent being grounded via a *knowledge service* (an MCP server), not because the knowledge files happen to be lying around. So the demo agent must not be able to learn anything about the bakery, the knowledge base, or the fact that this is a hackathon project except through the MCP tools (and only in the **with** demo).

"Cannot" needs to hold against an agent that is trying reasonably hard (Read, Glob, Grep, Bash `cat`/`find`/`grep -r`, git history), and against *accidental* leaks: things Claude Code injects into the model's context on its own (working directory, git status, parent `CLAUDE.md` files, sandbox rule listings).

It is **not** defending against a malicious human, nor against a determined attacker with code execution outside Claude Code's sandbox. It is a demo-integrity boundary.

## Layout

```
demos/with-knowledge/      seed files for the "with" demo    (copied, never run in place)
demos/without-knowledge/   seed files for the "without" demo (copied, never run in place)
scripts/run-demo.sh        the launcher: builds the sandbox and starts claude
knowledge/hearth-and-wheel/  the OKF bundle (only the MCP server reads this at runtime)
mcp-server/                the MCP server
```

At launch, `scripts/run-demo.sh` creates:

```
~/.agent-workspaces/a/project/   "with" workspace   (fresh copy of demos/with-knowledge)
~/.agent-workspaces/b/project/   "without" workspace (fresh copy of demos/without-knowledge)
~/.claude/.agent-gen/{a,b}/      generated settings.json + mcp.json
```

## What the launcher does

1. Picks the seed and slot (`with` = `a`, `without` = `b`).
2. Deletes and recreates the workspace, then `rsync`s the seed into it.
3. Generates `settings.json` and `mcp.json` (with absolute paths) into `~/.claude/.agent-gen/<slot>/`.
4. `cd`s into the workspace and `exec`s:

```
claude --settings <gen>/settings.json --mcp-config <gen>/mcp.json --strict-mcp-config --disable-slash-commands "$@"
```

## The isolation layers, and why each exists

### 1. Run outside the repo, in a neutral directory

If the demo ran inside `demos/without-knowledge/` in this repo, Claude Code would leak in several ways at once:

- The **working directory** is put in the model's context. `.../bakery-knowledge/demos/without-knowledge` names the experiment.
- The directory is inside a **git repo**, so Claude Code injects a git status block: top-level folder names (`knowledge/`, `meta/`, `open-knowledge-format/`) and recent commit messages.
- Claude Code loads **`CLAUDE.md` files from ancestor directories**, so the root `CLAUDE.md` (which says "hackathon") would be loaded. `claudeMdExcludes` could suppress it but needs the path, which itself appears in context.
- `git log`/`git show` from the subdirectory can read the entire repo history, including the knowledge files.

Running from `~/.agent-workspaces/<a|b>/project` removes all of these at the source: no parent repo, no ancestor `CLAUDE.md`, and a path that reveals nothing. The cost is that the workspace is a disposable copy; the seed in the repo is the source of truth. The two demos get identical-shaped paths on purpose.

### 2. Sandbox (Bash) — macOS Seatbelt

`sandbox.enabled` with `failIfUnavailable: true` (refuse to run unsandboxed) and `allowUnsandboxedCommands: false` (no escape hatch). `sandbox.filesystem.denyRead` covers the parent directory of the repo (e.g. `~/src`) and `~/.claude`; `allowWrite` is just the workspace. This blocks `cat`, `grep -r`, `find`, `ps aux`, etc. against the repo.

**Important:** this sandbox applies to Bash only. It does *not* stop the built-in Read, Glob, or Grep tools. We found this by testing: with only sandbox rules, the agent read the (then temporary) canary test file via Read/Glob/Grep.

### 3. Permission deny rules (Read/Edit tools)

`permissions.deny` has `Read(//<dir>/**)` and `Edit(//<dir>/**)` for the same two directories. Note:

- `//` means an absolute filesystem path (a single `/` means relative to the project root).
- A `Read(...)` rule covers all file-reading tools (Read, Grep, Glob). Separate `Glob(...)`/`Grep(...)` rules are rejected as invalid.
- `Bash(git:*)` and `Bash(git *)` are denied too. There is no repo above the workspace, but this is defence in depth.

### 4. Deny the *parent* of the repo, not the repo's folders

Deny rules are **shown to the agent** (they get merged into the sandbox listing in its context). Denying `~/src/bakery-knowledge/knowledge`, `.../meta`, etc. would advertise exactly the names we're hiding. Denying `~/src` reveals only `src`. (It also means the demo agent can't read your other projects under `~/src`, which is a nice side effect.)

### 5. Generated config lives under `~/.claude/`

Claude Code tells the agent the path of its `--settings` file (it protects it from edits). If that file sat in the repo the path would leak the repo name. `~/.claude/.agent-gen/` is inside an already-denied directory with a neutral name. Denying `~/.claude` also stops the agent reading session transcripts, which contain the developer's full conversation history about this project.

### 6. Other context leaks turned off

- `includeGitInstructions: false` (belt-and-braces; the workspace isn't a repo anyway).
- `autoMemoryEnabled: false` so the demos don't build up or share memory.
- `--disable-slash-commands` (no skills), `--strict-mcp-config` (only the servers in our `mcp.json`, so none of the developer's personal connectors leak in).

### What is *not* isolated

- Your **global** `~/.claude/CLAUDE.md` is still loaded into both demos. It's identical for both, so it doesn't affect the comparison, but it isn't hidden.
- The MCP server runs **unsandboxed** as you (Claude Code doesn't sandbox MCP processes). That's by design: it is the one component allowed to read the bundle. The agent can't see its command line because `ps` is blocked.
- The agent still has your normal network access.
- The CLI/model choices come from your normal Claude Code config (`--setting-sources` is not restricted), so keep both runs on the same model when comparing.

## The MCP wiring

`mcp.json` for **with**:

```json
{ "mcpServers": { "knowledge": {
  "command": "node",
  "args": ["<repo>/mcp-server/dist/index.js"],
  "env": { "OKF_BUNDLE_PATH": "<repo>/knowledge/hearth-and-wheel", "OKF_TRANSPORT": "stdio" }
} } }
```

For **without**, `mcpServers` is `{}` (with `--strict-mcp-config`, that means no MCP at all). The server is launched by Claude Code as a stdio child process. It is general purpose; nothing about it is bakery-specific. See [mcp-server.md](mcp-server.md).

## Verified behaviours (Claude Code 2.1.x)

Tested by running real sessions through the launcher:

- **without:** Read (relative and absolute), Glob, Grep, Bash `cat`, `grep -r`, and git could not reach the canary test file; reading `~/.claude/CLAUDE.md` was blocked.
- **with:** the canary test phrase was retrieved through `mcp__knowledge__*` only; direct reads stayed blocked; `ps aux` was blocked.
- **Context scan (both):** no occurrence of "hackathon", "Hearth", "bakery", "OKF", or "Open Knowledge" in the agent's context, and no repo/folder/commit names.

These are behaviours of a fast-moving tool; re-run the checks in [running-the-demos.md](running-the-demos.md#verifying-isolation) after upgrading Claude Code or editing the launcher.

## Gotchas learned the hard way

- Asking the model to "try hard to escape the sandbox" makes it *refuse*. That says nothing about enforcement. Use ordinary-sounding tasks that happen to hit blocked paths.
- The model will happily quote its own sandbox rule list back to you. Assume anything in the config is visible to it.
- Do not put hackathon/bakery wording into `demos/*`, into MCP tool descriptions, or into the server's examples (the server's descriptions use `finance/revenue` as a neutral example).
- Docker was tried first and dropped (enterprise plan can't mint a `setup-token`; the alternatives were an API key or copying Keychain credentials). The host-based approach above replaced it.

## Changing things safely

- **Add a new leak check:** ask each demo, with no tools, to list what appears in its context, and search for the sensitive words.
- **Add another denied location:** add it to the `denied` array in the launcher's inline Node script; it feeds both the sandbox and the permission rules.
- **Move the repo:** nothing is hard-coded; paths are derived from the script location and `$HOME`.
