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
#    parent rather than the repo keeps the repo's own name out of the agent's context. A few other
#    places that would reveal the repo or hold credentials are denied too (see DENIED below), and
#    so is the *other* demo's workspace, so the two demos cannot see each other.
#  - Generated config lives in ~/.claude/.agent-gen/ (denied to the agent; a path inside the repo
#    would leak its name, because Claude Code lists its own settings file path to the agent).
#  - Nothing about this repo is exported into claude's environment: the config variables are set
#    only for the node command that generates the config, and OLDPWD (the repo root, since you
#    launch from there) is cleared before exec.
#  - The knowledge MCP server (with only) is an unsandboxed stdio process launched by Claude Code.
set -euo pipefail

die() { echo "run-demo: $*" >&2; exit 1; }

MODE="${1:?usage: run-demo.sh with|without [claude args...]}"; shift
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
case "$MODE" in
  with)    SEED="$ROOT/demos/with-knowledge";    SLOT=a; OTHER=b ;;
  without) SEED="$ROOT/demos/without-knowledge"; SLOT=b; OTHER=a ;;
  *) die "mode must be 'with' or 'without'" ;;
esac

# --- Preflight: fail loudly rather than run a demo that silently differs from what you expect.
[ -n "${HOME:-}" ] || die "HOME is not set"
for tool in node rsync claude; do command -v "$tool" >/dev/null || die "'$tool' not found on PATH"; done
if [ "$MODE" = with ] && [ ! -f "$ROOT/mcp-server/dist/index.js" ]; then
  die "knowledge server not built: (cd mcp-server && npm install && npm run build)"
fi

WORK="$HOME/.agent-workspaces/$SLOT/project"
PARENT="$(dirname "$ROOT")"
# The parent of the repo is denied to the agent. If it is / or $HOME, or contains the workspace,
# the agent would be denied its own working directory.
case "$PARENT" in
  /|"$HOME") die "repo is directly under '$PARENT'; move it into a subdirectory such as ~/src" ;;
esac
case "$WORK" in
  "$PARENT"/*) die "the workspace ($WORK) would be inside the denied directory $PARENT" ;;
esac

GEN="$HOME/.claude/.agent-gen/$SLOT"; mkdir -p "$GEN"

# One session per slot: relaunching would delete the workspace under a live session.
# (exec keeps this PID, so the lock holder is the claude process.) A bare "is that PID alive?"
# check would wrongly refuse if the OS had reused a dead session's PID for something else, so
# also require that the process is a claude started with this slot's generated settings file.
if [ -f "$GEN/lock" ]; then
  holder="$(cat "$GEN/lock")"
  if kill -0 "$holder" 2>/dev/null && ps -p "$holder" -o command= 2>/dev/null | grep -qF -- "$GEN/settings.json"; then
    die "a '$MODE' demo is already running (pid $holder)"
  fi
fi
echo $$ > "$GEN/lock"

rm -rf "$WORK"; mkdir -p "$WORK"
rsync -a --exclude .gitkeep "$SEED"/ "$WORK"/

# Variables are prefixed onto the node command only, so they are not exported to claude.
DEMO_ROOT="$ROOT" DEMO_WORK="$WORK" DEMO_MODE="$MODE" DEMO_GEN="$GEN" DEMO_OTHER="$HOME/.agent-workspaces/$OTHER" \
node --input-type=module -e '
import fs from "node:fs"; import path from "node:path";
const e = process.env, h = e.HOME;
// DENIED: paths the agent must not read (Bash via the sandbox, Read/Grep/Glob via permission rules).
const denied = [
  path.dirname(e.DEMO_ROOT),          // the repo lives somewhere under here
  e.DEMO_OTHER,                       // the other demo'"'"'s workspace
  `${h}/.claude`,                     // transcripts, config, and our generated settings
  `${h}/.claude.json`,                // per-project state keyed by absolute path (names the repo)
  `${h}/.zsh_history`, `${h}/.bash_history`, `${h}/.zsh_sessions`, // shell history shows how the demo was launched
  `${h}/.ssh`, `${h}/.aws`, `${h}/.config/gh`,                     // credentials
];
const settings = {
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    filesystem: { denyRead: denied, allowWrite: [e.DEMO_WORK] },
  },
  permissions: {
    // A rule for the path itself covers files; the /** rule covers directory contents.
    deny: [...denied.flatMap(p => [`Read(/${p})`, `Read(/${p}/**)`, `Edit(/${p})`, `Edit(/${p}/**)`]), "Bash(git:*)", "Bash(git *)"],
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

cd -P "$WORK"
unset OLDPWD   # cd sets and exports it; it would be the repo root
exec claude --settings "$GEN/settings.json" --mcp-config "$GEN/mcp.json" --strict-mcp-config \
  --disable-slash-commands "$@"
