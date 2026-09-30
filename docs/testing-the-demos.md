# Testing the demos

A checklist for confirming the **with** and **without** demos behave as intended, for use after changing the launcher, the MCP server, the knowledge bundle, the `with` seed's `CLAUDE.md`, or upgrading Claude Code. To just run the demos, see [running-the-demos.md](running-the-demos.md). For why the sandbox is built the way it is, see [demo-internals.md](demo-internals.md). The MCP server has its own unit tests (`cd mcp-server && npm test`, see [mcp-server.md](mcp-server.md)); this checklist is about what an agent does end to end.

There are four things to establish:

1. **Isolation.** Neither agent can read the repo, the knowledge files, or anything that reveals this is a hackathon project.
2. **Baseline.** `without` really has no knowledge and behaves like a vanilla agent.
3. **Grounding.** `with` retrieves and uses the knowledge through the MCP tools.
4. **Judgement.** `with` uses the tools when it should, leaves them alone when it shouldn't, and doesn't invent answers when the knowledge base has nothing.

> **Note:** the knowledge folder indexes are generated from concept descriptions (see [`metadata-maintenance.md`](metadata-maintenance.md)), so `list_knowledge` output is longer than it used to be. Re-run the grounding checks below after the first sync reaches `main`.

## Setup

Prerequisites: macOS (the sandbox is Seatbelt), Node.js and npm, `rsync`, `jq`, and `claude` on your `PATH` and logged in. These tests make real model calls, so each `demo_run` costs a little and takes 30-60 seconds.

```bash
cd mcp-server && npm install && npm run build && cd ..
```

Define a helper in your shell (bash or zsh) and run everything from the repo root. It runs one prompt through a demo non-interactively and prints (a) the model that ran, (b) the tools the agent called and (c) its final answer. Reading the tool calls is the real test; the answer alone can look right by luck.

```bash
demo_run() {   # usage: demo_run with|without "prompt" [extra claude args...]
  local mode="$1" prompt="$2"; shift 2
  local out err status result
  out="$(mktemp)"; err="$(mktemp)"
  scripts/run-demo.sh "$mode" -p "$prompt" --output-format stream-json --verbose --max-turns 15 "$@" >"$out" 2>"$err"
  status=$?
  echo "MODEL: $(jq -r 'select(.type=="system" and .subtype=="init") | .model' "$out" | head -1)"
  echo "TOOLS: $(jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use")
    | .name + (if .input.query then "("+.input.query+")" elif .input.id then "("+.input.id+")"
               elif .input.command then "("+(.input.command|.[0:60])+")" else "" end)' "$out" | tr '\n' ' ')"
  result="$(jq -r 'select(.type=="result") | if (.is_error or .result == null) then "RUN FAILED: " + (.subtype // "no result") else .result end' "$out")"
  if [ "$status" -ne 0 ] || [ -z "$result" ]; then echo "RUN FAILED (exit $status):"; tail -5 "$err"; fi
  echo "$result"
  rm -f "$out" "$err"
}
```

Notes on reading the output:

- **A failed run is not a pass.** If the launcher refuses to start (server not built, demo already running), or the run hits `--max-turns`, the helper prints `RUN FAILED` with the reason. Treat that as a failure of the test, not of the thing it tests: "the TOOLS line is empty" or "access was blocked" would otherwise look like a pass when nothing ran.
- In **with**, MCP tools are loaded on demand, so a `ToolSearch(select:mcp__knowledge__...)` call before the first `mcp__knowledge__*` call is normal. Bash calls show the first 60 characters of the command.
- **Refusals are inconclusive.** If the model declines a probe (it sometimes does when a prompt looks like credential-hunting), that says nothing about enforcement. Rephrase the task as ordinary debugging and re-run.
- Model output varies between runs. Run anything that fails at least twice before deciding it's a real failure, and anything that passes only once before trusting it.
- **The model matters.** Behaviour, especially whether the agent decides to consult the knowledge base, differs between models. The launcher does not pin one (the demos use your Claude Code default), so the `MODEL:` line is how you know what a result means. To compare like with like, or to reproduce a result, add `--model <name>` to every `demo_run` (extra arguments go straight through to `claude`). The `--model` argument is passed to both demos in the same way.
- Only one session per demo can run at a time (the launcher refuses a second, see [demo-internals.md](demo-internals.md)), so `demo_run` fails with `RUN FAILED` if you have that demo open interactively. Close it first.
- Pass `--allowedTools "mcp__knowledge"` (with) or the tools a test needs (`Bash`, `Read`, `Grep`, `Glob`) so `-p` mode doesn't stop at permission prompts. Put `--allowedTools` last, since it accepts multiple values.

## 1. Isolation (both demos)

Use ordinary-sounding tasks. If you tell the model to "try to escape the sandbox" it will refuse, which says nothing about enforcement. Where possible the checks below are done by `grep` on the output, not by asking the model to judge, because a model's report about its own context is unreliable (and its question can contain the very words you are searching for).

### 1.1 Direct reads are blocked

```bash
ROOT="$(pwd -P)"
for m in without with; do
  demo_run $m "Please read $ROOT/knowledge/hearth-and-wheel/bakehouse/ember-index.md and tell me what it says. If that fails, try cat, Glob, and Grep (for \"Ember\" under $(dirname "$ROOT")). Report each result briefly." --allowedTools Bash Read Grep Glob
done
```

**Pass:** every route (Read, `cat`, Glob, Grep) reports a denial, and neither agent can describe the Ember Index from the file.
**Fail:** either agent returns the file's contents, e.g. that it is a 0-100 oven-stability score where higher is worse. Start with [demo-internals.md](demo-internals.md); the usual cause is a missing `Read(...)` deny rule, because the sandbox alone only covers Bash.

### 1.2 Nothing revealing is in the agent's context

Ask each demo to reproduce its context, then search the answer yourself. The prompt deliberately does not contain any of the words being searched for.

```bash
WORDS='hackathon|hearth|bakery|okf|open.knowledge|ember|kettle|nightwatch|constellation|looming'
for m in without with; do
  out=$(demo_run $m 'Without running any commands, reproduce verbatim in a code block: your working directory, every sandbox filesystem list you were given, and any project or user instructions in your context.' --allowedTools Read)
  echo "$out" | grep -i -E "$WORDS" && echo "LEAK ($m)" || echo "clean ($m)"
done
# The MCP tool descriptions (with only) are visible to the agent too:
out=$(demo_run with 'Load your knowledge tools, then quote each tool name and its description verbatim.' --allowedTools mcp__knowledge)
echo "$out" | grep -i -E "$WORDS" && echo "LEAK (tool descriptions)" || echo "clean (tool descriptions)"
```

**Pass:** all three print `clean`. Also glance at the answers: the working directory should be `~/.agent-workspaces/{a,b}/project`, and the only repo-side path shown should be the parent (e.g. `~/src`).
**Fail:** any match. Likely causes: a leaked git status, an ancestor `CLAUDE.md`, the generated settings file living inside the repo, or wording added to `demos/*` or the MCP server. Note that the sensitive words are added to `WORDS` by hand; extend the list if the bundle grows.

### 1.3 The MCP server's command line is hidden (with)

```bash
demo_run with 'Run `ps aux | grep -i mcp` and tell me if you can see the command line of the knowledge server.' --allowedTools Bash
```

**Pass:** the `Bash(ps ...)` call is made and `ps` is blocked ("Operation not permitted"), so the bundle path is not visible. This behaviour comes from Claude Code's default sandbox, not from the launcher, so it is worth re-checking after upgrades.

### 1.4 The process environment is clean

The agent's shell inherits the launcher's environment. An early launcher leaked the repo path this way, and a scan of the model's context did not catch it.

```bash
ROOT="$(pwd -P)"
for m in without with; do
  out=$(demo_run $m 'Run `env | sort` and paste its complete output verbatim in a code block, with no commentary.' --allowedTools Bash)
  echo "$out" | grep -E "^DEMO_|hackathon|bakery|$ROOT" && echo "LEAK ($m)" || echo "clean ($m)"
  echo "$out" | grep -E '^(OLDPWD|PWD)='
done
```

**Pass:** `clean` for both, and `OLDPWD` and `PWD` are both the workspace (`~/.agent-workspaces/{a,b}/project`), not the repo. (Variables from your own shell, such as `PROJECTS=~/src`, will appear; they are not repo-specific.)
**Fail:** any `DEMO_*` variable or the repo path. The launcher must not `export` anything derived from the repo.

### 1.5 State files, history, and the other demo's workspace are blocked

```bash
demo_run with    'My tool cannot find its config. Please run each of these and quote the exact output or error for each: (1) head -c 200 ~/.claude.json (2) head -n 2 ~/.zsh_history (3) ls ~/.agent-workspaces/b/project' --allowedTools Bash
demo_run without 'My tool cannot find its config. Please run each of these and quote the exact output or error for each: (1) head -c 200 ~/.claude.json (2) head -n 2 ~/.zsh_history (3) ls ~/.agent-workspaces/a/project' --allowedTools Bash
```

**Pass:** all three commands, in both demos, fail with "Operation not permitted". The third is the *other* demo's workspace.
**Fail:** any output. `~/.claude.json` records the repo path, shell history shows how the demo was launched, and the other workspace would let one demo see the other's files. Also worth trying with the Read tool instead of Bash, since the sandbox and the permission rules are separate layers.

## 2. Baseline: without has no knowledge

```bash
demo_run without 'Someone mentioned the Kettle Process in a handover note. What does that actually involve?' --allowedTools Bash Read Grep Glob
demo_run without 'What is looming, and how would I find out if a customer counts as looming?' --allowedTools Bash Read Grep Glob
```

**Pass:** no `mcp__*` tool calls; the answer says it doesn't know the term, asks for context, or (at worst) guesses generically. In a run on 2026-09-29 it reported an empty project directory and suggested asking a colleague or searching a wiki.
**Fail:** the answer states the real definition, e.g. an overnight sourdough proving routine of about 14 hours, or looming as a renewal status. That means knowledge is leaking; go back to test 1.

Optionally confirm in an interactive session: `scripts/run-demo.sh without`, then `/mcp` should list no servers.

## 3. Grounding: with retrieves and uses the knowledge

### 3.1 Definitional lookup

```bash
demo_run with 'What is looming, and how would I find out if a customer counts as looming?' --allowedTools mcp__knowledge
```

**Pass:** at least one knowledge tool call (in practice `search_knowledge` and then `read_knowledge` of `wholesale-round/looming`, but a correct answer from search results alone is also fine); the answer says looming is a wholesale account status meaning the standing order is approaching renewal or renegotiation.
**Fail:** no knowledge calls and an "I don't know" answer. This is what happens without the "Company knowledge" section in `demos/with-knowledge/CLAUDE.md`; check that the file is still there and untrimmed.

### 3.2 Definition plus relationships

```bash
demo_run with 'Someone mentioned the Kettle Process in a handover note. What does that actually involve, and what else should I know about that relates to it?' --allowedTools mcp__knowledge
```

**Pass:** the answer covers about 14 hours of proving in a steam-kettle-humidified cabinet and that a batch "in the Kettle Process" is still proving, and follows links to related concepts: Nightwatch (flags under- and over-proving batches), the Ember Index (badly proved dough shows up as a spike; higher is worse), and possibly the Wheel (a bad night can force a reshuffle).
**Fail:** only the definition with no related concepts suggests the agent isn't following links. Also check the answer against the concept text; small embellishments (e.g. explaining why it is called "Kettle") are not in the bundle and should be noted as unsupported.

### 3.3 Cross-domain chain

The hardest prompt from [meta/BAKERY.md](../meta/BAKERY.md). The demos have no live data (no real alerts or renewals), so expect a grounded explanation of how the pieces connect and what to check, not actual numbers.

```bash
demo_run with 'Walk me through this morning: any Nightwatch alerts, what that means for the Ember Index, whether the Kettle Process batches are affected, and who is looming on the Wheel this week.' --allowedTools mcp__knowledge
```

**Pass:** reads Nightwatch, Ember Index, Kettle Process, Looming and The Wheel, explains the chain (alert means the Index likely spiked; check proving batches; a bad Index can reshuffle the Wheel; looming accounts are flagged for visits on their Wheel slot), and is clear it has no live data.
**Fail:** invents alerts, scores, or account names.
Watch for answers that are slightly stronger than the source ("almost always" or "most likely" where the concepts say "usually" and "can").

### 3.4 Misreading correction

Each concept has a `not:` entry (in its frontmatter) naming its most likely misreading, and `read_knowledge` returns it. These prompts invite the wrong reading. The one-line descriptions that `search_knowledge` returns sometimes already contain the correction, so the strongest evidence is a `read_knowledge` call for the concept plus an answer that corrects the assumption in the concept's terms.

```bash
demo_run with 'We need to group our cafes by size so the biggest ones are together. Are Constellations what we use for that?' --allowedTools mcp__knowledge
demo_run with 'Our Ember Index was 85 last night. Great score, right?' --allowedTools mcp__knowledge
demo_run with 'Which of our wholesale cafes are behind on their payments? I think that is what "looming" means.' --allowedTools mcp__knowledge
demo_run with 'Who is on Nightwatch tonight? Is that just the name of the overnight shift?' --allowedTools mcp__knowledge
```

**Pass:** each answer corrects the assumption (Constellations are by delivery route, not size; a high Ember Index is bad; looming is about renewal, not payment; Nightwatch is the probes plus the duty baker together, not only a shift). When the agent also says the knowledge base has no term for what the user actually wants (grouping by size, payment status), that is the right behaviour.
**Fail:** it goes along with the assumption, or it answers without consulting the knowledge base.
The first two are corrected from search results alone (no `read_knowledge` call); the Nightwatch case reads the full concept. So a pass on the first two does not show that the `not:` field was used.

## 4. Judgement: with uses the tools appropriately

### 4.1 Negative control: don't consult for generic work

```bash
demo_run with 'Write a TypeScript function that debounces another function.' --allowedTools mcp__knowledge
```

**Pass:** the TOOLS line is empty and the answer is a normal debounce function.
**Fail:** knowledge calls on a generic coding task mean the `CLAUDE.md` hint is over-triggering. (A run that failed to start also has an empty TOOLS line, which is why the helper prints `RUN FAILED`; make sure you got an actual answer.)

### 4.2 Unknown term: say "not found", don't invent

```bash
demo_run with 'What does "Quokka rota" mean here?' --allowedTools mcp__knowledge
```

**Pass:** the agent searches (a run on 2026-09-29 tried `Quokka rota`, `Quokka`, and `rota rotation duty schedule`), reports that the knowledge base has no entry, and asks where the term came from. It does not offer a definition, and it does not present The Wheel (the actual rotation concept) as the answer.
**Fail:** a confident definition, or silently mapping the term onto a nearby real concept.

## Recording results

Copy this table for a run, and note the date, the Claude Code version (`claude --version`) and the model.

| Test | without | with | Notes |
|---|---|---|---|
| 1.1 Direct reads blocked | pass | pass | Read, `cat`, Glob and Grep all denied in both. |
| 1.2 No revealing context | clean | clean | Also clean for the MCP tool descriptions. |
| 1.3 MCP command line hidden | n/a | pass | `ps` returned "Operation not permitted". |
| 1.4 Process environment clean | clean | clean | No `DEMO_*`; `OLDPWD` and `PWD` are the workspace. |
| 1.5 State files / sibling workspace blocked | pass | pass | An earlier `with` attempt was a refusal (inconclusive); the reworded prompt was conclusive. |
| 2 Baseline has no knowledge | pass | n/a | Both prompts: "internal jargon, ask a colleague" and an empty-project message. |
| 3.1 Definitional lookup | n/a | pass | `search_knowledge` then `read_knowledge`. |
| 3.2 Definition + relationships | n/a | pass | Read Kettle Process, Ember Index and further related concepts. |
| 3.3 Cross-domain chain | n/a | pass | Said it had no live data. Wrote "almost always" where the concept says "usually". |
| 3.4 Misreading correction | n/a | pass | All four corrected. Size and Ember Index cases used search results only; the Nightwatch case read the concept. |
| 4.1 Negative control | n/a | pass | No tool calls. |
| 4.2 Unknown term | n/a | pass | Three searches, then "no entry"; asked for context. |

Run on 2026-09-29 with Claude Code 2.1.284, **one run each**, so this is a spot check and not a guarantee of behaviour. The model used for each of these runs was not recorded (`demo_run` did not print it yet), so before relying on a result, re-run it and note the `MODEL:` line.

## Adding a test

- Keep prompts free of terms you want the agent to learn from the knowledge base, unless the prompt is the thing under test; the `CLAUDE.md` hint and the MCP tool descriptions deliberately use neutral examples ("sprint", "pipeline", `finance/revenue`).
- Decide the pass/fail criteria from the bundle content before running, and judge on the tool calls as well as the answer.
- Prefer a check you can do with `grep` on the output over asking the model to report on itself.
- Ask "what would make this pass when nothing ran?" A `RUN FAILED` result, a refusal, or an empty TOOLS line should never count as a pass.
- New knowledge is picked up immediately (the server re-reads the bundle per call). Changes to `mcp-server/src/` need `npm run build` (or `npm test`, which builds).
