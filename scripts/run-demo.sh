#!/usr/bin/env bash
# Launch a sandboxed demo Claude Code session.
#   scripts/run-demo.sh with|without [extra claude args...]
#
# Isolation approach (no Docker):
#  - The demo folder in this repo is only a *seed*. It is copied fresh into a neutrally named
#    workspace outside the repo (~/.agent-workspaces/{a,b}/project), so the session has no
#    parent git repo, no ancestor CLAUDE.md, and a cwd that reveals nothing.
#  - The whole parent of this repo (e.g. ~/src) is denied to Bash (sandbox) AND to the Read/Grep/
#    Glob tools (permission rules; the sandbox alone does not cover those tools). Denying the
#    parent rather than the repo keeps the repo's own name out of the agent's context.
#  - Generated config lives in ~/.claude/.agent-gen/ (denied to the agent; a path inside the repo
#    would leak its name, because Claude Code lists its own settings file path to the agent).
#  - The knowledge MCP server (with only) is an unsandboxed stdio process launched by Claude Code.
set -euo pipefail

MODE="${1:?usage: run-demo.sh with|without [claude args...]}"; shift
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
case "$MODE" in
  with)    SEED="$ROOT/demos/with-knowledge";    SLOT=a ;;
  without) SEED="$ROOT/demos/without-knowledge"; SLOT=b ;;
  *) echo "mode must be 'with' or 'without'" >&2; exit 2 ;;
esac
WORK="$HOME/.agent-workspaces/$SLOT/project"
GEN="$HOME/.claude/.agent-gen/$SLOT"; mkdir -p "$GEN"

rm -rf "$WORK"; mkdir -p "$WORK"
rsync -a --exclude .gitkeep "$SEED"/ "$WORK"/

export DEMO_ROOT="$ROOT" DEMO_WORK="$WORK" DEMO_MODE="$MODE" DEMO_GEN="$GEN"
node --input-type=module -e '
import fs from "node:fs"; import path from "node:path";
const e = process.env;
const denied = [path.dirname(e.DEMO_ROOT), `${e.HOME}/.claude`];
const settings = {
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    filesystem: { denyRead: denied, allowWrite: [e.DEMO_WORK] },
  },
  permissions: {
    deny: [...denied.flatMap(p => [`Read(/${p}/**)`, `Edit(/${p}/**)`]), "Bash(git:*)", "Bash(git *)"],
  },
  includeGitInstructions: false,
  autoMemoryEnabled: false,
};
fs.writeFileSync(`${e.DEMO_GEN}/settings.json`, JSON.stringify(settings, null, 2));
const mcp = { mcpServers: e.DEMO_MODE === "with" ? { knowledge: {
  command: "node",
  args: [`${e.DEMO_ROOT}/mcp-server/dist/index.js`],
  env: { OKF_BUNDLE_PATH: `${e.DEMO_ROOT}/knowledge/hearth-and-wheel`, OKF_TRANSPORT: "stdio" },
} } : {} };
fs.writeFileSync(`${e.DEMO_GEN}/mcp.json`, JSON.stringify(mcp, null, 2));
'

cd "$WORK"
exec claude --settings "$GEN/settings.json" --mcp-config "$GEN/mcp.json" --strict-mcp-config \
  --disable-slash-commands "$@"
