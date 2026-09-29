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
2. Preflight: checks that `node`, `rsync` and `claude` exist; for `with`, that the MCP server is built; and that the repo's parent directory is not `/` or `$HOME` (it is denied to the agent, so the workspace would be denied too). Any failure exits with a message instead of quietly running a demo that differs from what you expect.
3. Takes a per-slot lock (`~/.claude/.agent-gen/<slot>/lock`, holding the PID; `exec` keeps the PID, so it is the `claude` process). A second launch of a live slot is refused, because step 4 would delete the workspace under a running session. A lock left by a dead process is ignored.
4. Deletes and recreates the workspace, then `rsync`s the seed into it.
5. Generates `settings.json` and `mcp.json` (with absolute paths) into `~/.claude/.agent-gen/<slot>/`. The config variables are passed to that one `node` command only, not exported.
6. `cd`s into the workspace, clears `OLDPWD` (which `cd` exports and which would be the repo root), and `exec`s:

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

`sandbox.enabled` with `failIfUnavailable: true` (refuse to run unsandboxed) and `allowUnsandboxedCommands: false` (no escape hatch). `sandbox.filesystem.denyRead` covers a `denied` list (defined once in the launcher and reused for the permission rules below); `allowWrite` is just the workspace. This blocks `cat`, `grep -r`, `find`, `ps aux`, etc. against the denied paths.

The `denied` list:

| Path | Why |
|---|---|
| the repo's parent (e.g. `~/src`) | contains the repo and the knowledge files; denying the parent rather than the repo keeps the repo's name out of the agent's context |
| `~/.agent-workspaces/<other slot>` | the other demo's workspace, so the two demos can't read each other's files |
| `~/.claude` | session transcripts (the developer's full conversation about this project), config, and the generated settings |
| `~/.claude.json` | per-project state keyed by absolute path, which names the repo; it sits *next to* `~/.claude/`, not inside it |
| `~/.zsh_history`, `~/.bash_history`, `~/.zsh_sessions` | show how the demo was launched |
| `~/.ssh`, `~/.aws`, `~/.config/gh` | credentials, an unrelated risk that costs nothing to close |

**Important:** this sandbox applies to Bash only. It does *not* stop the built-in Read, Glob, or Grep tools. We found this by testing: with only sandbox rules, the agent read the (then temporary) canary test file via Read/Glob/Grep.

### 3. Permission deny rules (Read/Edit tools)

`permissions.deny` has `Read(//<path>)`, `Read(//<path>/**)` and the same for `Edit`, for every path in the `denied` list (the bare-path rule covers files such as `~/.claude.json`; the `/**` rule covers directory contents). Note:

- `//` means an absolute filesystem path (a single `/` means relative to the project root).
- A `Read(...)` rule covers all file-reading tools (Read, Grep, Glob). Separate `Glob(...)`/`Grep(...)` rules are rejected as invalid.
- `Bash(git:*)` and `Bash(git *)` are denied too. There is no repo above the workspace, but this is defence in depth.

### 4. Deny the *parent* of the repo, not the repo's folders

Deny rules are **shown to the agent** (they get merged into the sandbox listing in its context). Denying `~/src/bakery-knowledge/knowledge`, `.../meta`, etc. would advertise exactly the names we're hiding. Denying `~/src` reveals only `src`. (It also means the demo agent can't read your other projects under `~/src`, which is a nice side effect.)

### 5. Generated config lives under `~/.claude/`

Claude Code tells the agent the path of its `--settings` file (it protects it from edits). If that file sat in the repo the path would leak the repo name. `~/.claude/.agent-gen/` is inside an already-denied directory with a neutral name. Denying `~/.claude` also stops the agent reading session transcripts, which contain the developer's full conversation history about this project.

### 6. Other leaks turned off

- **Environment variables.** Claude Code passes its environment to the agent's Bash tool. An early version of the launcher `export`ed `DEMO_ROOT` (the repo path) and `DEMO_MODE` (`with`/`without`) and left `OLDPWD` set to the repo root, so `env` in the agent's shell revealed all three. Now the config variables are set only for the `node` command that generates the config, and `OLDPWD` is unset before `exec`. The context scan in "Verified behaviours" only covers what is in the *model's context*; the process environment needs its own check (see [testing-the-demos.md](testing-the-demos.md)).
- `includeGitInstructions: false` (belt-and-braces; the workspace isn't a repo anyway).
- `autoMemoryEnabled: false` so the demos don't build up or share memory.
- `--disable-slash-commands` (no skills), `--strict-mcp-config` (only the servers in our `mcp.json`, so none of the developer's personal connectors leak in).

### What is *not* isolated

- Your **global** `~/.claude/CLAUDE.md` is still loaded into both demos. It's identical for both, so it doesn't affect the comparison, but it isn't hidden.
- The MCP server runs **unsandboxed** as you (Claude Code doesn't sandbox MCP processes). That's by design: it is the one component allowed to read the bundle. The agent couldn't see its command line in testing because `ps` is blocked. That comes from Claude Code's default sandbox behaviour, not from anything this launcher configures, so re-check it after upgrades.
- The agent still has your normal **network access**, including WebFetch/WebSearch/`curl`. If this repo were ever public, an agent could search for it. Keep the repo private while running demos, or deny those tools.
- Claude Code's user settings still apply (`--setting-sources` is not restricted), so your hooks, plugins and model choice carry into both demos. Keep both runs on the same model when comparing.
- Your shell's **environment** is inherited. Nothing repo-specific is added by the launcher, but variables you already have set (e.g. `PROJECTS=~/src`, `PATH` entries) are visible to the agent.
- Claude Code's per-session scratch directories under `/private/tmp/claude-<uid>/` are not denied: the demo sessions need their own, so denying the directory would break them. Directories from *development* sessions in this repo have the repo path in their name and remain readable.
- `ls ~/.agent-workspaces` works and shows the two slot names; only the other slot's contents are denied.
- The denied list is a blocklist. Anything not on it (other dotfiles, other home directories) is readable. Extend it if your machine has something sensitive.

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
- **Environment (without):** after the fix, `env` shows no `DEMO_*` variables and `OLDPWD` is the workspace. `~/.claude.json` and `~/.zsh_history` are unreadable via Bash and Read. `~/.agent-workspaces/a/project/CLAUDE.md` (the other demo's workspace) is unreadable via Bash and Read.
- **Launcher guards:** a live lock refuses a second launch and a stale lock is ignored; a repo directly under `$HOME` is refused; `with` refuses to start if the server isn't built.

These are behaviours of a fast-moving tool; re-run the checks in [running-the-demos.md](running-the-demos.md#verifying-isolation) after upgrading Claude Code or editing the launcher.

## Gotchas learned the hard way

- Asking the model to "try hard to escape the sandbox" makes it *refuse*. That says nothing about enforcement. Use ordinary-sounding tasks that happen to hit blocked paths.
- The model will happily quote its own sandbox rule list back to you. Assume anything in the config is visible to it.
- Checking the model's *context* is not the same as checking the *process*. The first launcher passed the context scan while leaking the repo path through environment variables, and it didn't deny `~/.claude.json`, which sits beside `~/.claude/` and so is easy to miss. A code review caught both.
- Do not put hackathon/bakery wording into `demos/*`, into MCP tool descriptions, or into the server's examples (the server's descriptions use `finance/revenue` as a neutral example).
- Docker was tried first and dropped (enterprise plan can't mint a `setup-token`; the alternatives were an API key or copying Keychain credentials). The host-based approach above replaced it.

## Changing things safely

- **Add a new leak check:** ask each demo, with no tools, to list what appears in its context, and search for the sensitive words.
- **Add another denied location:** add it to the `denied` array in the launcher's inline Node script; it feeds both the sandbox and the permission rules.
- **Move the repo:** paths are derived from the script location and `$HOME`, so it can live anywhere *except* directly under `$HOME` or `/`: the repo's parent is denied to the agent, and the workspace lives under `$HOME`, so the launcher refuses to start in that case.
