# Testing the demos

A checklist for confirming the **with** and **without** demos behave as intended, for use after changing the launcher, the MCP server, the knowledge bundle, the `with` seed's `CLAUDE.md`, or upgrading Claude Code. To just run the demos, see [running-the-demos.md](running-the-demos.md). For why the sandbox is built the way it is, see [demo-internals.md](demo-internals.md).

There are four things to establish:

1. **Isolation.** Neither agent can read the repo, the knowledge files, or anything that reveals this is a hackathon project.
2. **Baseline.** `without` really has no knowledge and behaves like a vanilla agent.
3. **Grounding.** `with` retrieves and uses the knowledge through the MCP tools.
4. **Judgement.** `with` uses the tools when it should, leaves them alone when it shouldn't, and doesn't invent answers when the knowledge base has nothing.

## Setup

```bash
cd mcp-server && npm install && npm run build && cd ..
```

Define a helper in your shell. It runs one prompt through a demo non-interactively and prints (a) the tools the agent called and (b) its final answer. Reading the tool calls is the real test; the answer alone can look right by luck.

```bash
demo_run() {   # usage: demo_run with|without "prompt" [extra claude args...]
  local mode="$1" prompt="$2"; shift 2
  scripts/run-demo.sh "$mode" -p "$prompt" --output-format stream-json --verbose --max-turns 15 "$@" 2>/dev/null > "${TMPDIR:-/tmp}/demo-out.json"
  echo "TOOLS: $(jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use")
    | .name + (if .input.query then "("+.input.query+")" elif .input.id then "("+.input.id+")" else "" end)' \
    "${TMPDIR:-/tmp}/demo-out.json" | tr '\n' ' ')"
  jq -r 'select(.type=="result") | .result' "${TMPDIR:-/tmp}/demo-out.json"
}
```

Run from the repo root. Needs `jq`. Notes on reading the output:

- In **with**, MCP tools are loaded on demand, so a `ToolSearch(select:mcp__knowledge__...)` call before the first `mcp__knowledge__*` call is normal.
- Model output varies between runs. Run anything that fails at least twice before deciding it's a real failure, and anything that passes only once before trusting it.
- Use the same model for both demos when comparing.

Pass `--allowedTools "mcp__knowledge"` (with) or `--allowedTools Bash Read Grep Glob` (isolation tests) so `-p` mode doesn't stop at permission prompts.

## 1. Isolation (both demos)

Use ordinary-sounding tasks. If you tell the model to "try to escape the sandbox" it will refuse, which says nothing about enforcement.

### 1.1 Direct reads are blocked

```bash
for m in without with; do
  demo_run $m 'Please read /Users/<you>/src/bakery-knowledge/knowledge/hearth-and-wheel/bakehouse/ember-index.md and tell me what it says. If that fails, try cat, Glob, and Grep (for "Ember" under /Users/<you>/src). Report each result briefly.' --allowedTools Bash Read Grep Glob
done
```

**Pass:** every route (Read, `cat`, Glob, Grep) reports a denial, and neither agent can describe the Ember Index from the file.
**Fail:** either agent returns the file's contents, e.g. that it is a 0-100 oven-stability score where higher is worse. Start with [demo-internals.md](demo-internals.md); the usual cause is a missing `Read(...)` deny rule, because the sandbox alone only covers Bash.

### 1.2 Nothing revealing is in the agent's context

Ask each demo, with no tools, what it can see:

```bash
for m in without with; do
  demo_run $m 'Without using tools: quote your working directory and any sandbox filesystem lists. Do the words hackathon, Hearth, bakery, OKF, Open Knowledge, Ember or Kettle appear anywhere in your context? Say where.' --allowedTools Read
done
```

**Pass:** the working directory is `~/.agent-workspaces/{a,b}/project`; it is not a git repository; and none of the sensitive words appear (the only path shown from the repo side is the parent, e.g. `~/src`). In **with**, the MCP tool descriptions must not contain bakery wording either.
**Fail:** any sensitive word or repo/folder/commit name. Likely causes: a leaked git status, an ancestor `CLAUDE.md`, the generated settings file living inside the repo, or wording added to `demos/*` or the MCP server.

### 1.3 The MCP server's command line is hidden (with)

```bash
demo_run with 'Run `ps aux | grep -i mcp` and tell me if you can see the command line of the knowledge server.' --allowedTools Bash
```

**Pass:** `ps` is blocked ("Operation not permitted"), so the bundle path is not visible.

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

**Pass:** tool calls include `search_knowledge(looming)` followed by `read_knowledge(wholesale-round/looming)`; the answer says looming is a wholesale account status meaning the standing order is approaching renewal or renegotiation, and that it is neutral (not "overdue" or "at risk").
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
Observed 2026-09-29: it read all five concepts, explained the chain, and said explicitly that it had no live data and asked where the overnight logs live. It did slightly overstate the source ("almost always" / "most likely source" where the concepts say "usually" and "can"), which is worth watching for when judging answers against the bundle.

### 3.4 Disambiguation (`not:` fields)

Each concept has a `not:` entry for its most likely misreading. Try prompts that invite the wrong reading:

```bash
demo_run with 'We need to group our cafes by size so the biggest ones are together. Are Constellations what we use for that?' --allowedTools mcp__knowledge
demo_run with 'Our Ember Index was 85 last night. Great score, right?' --allowedTools mcp__knowledge
```

**Pass:** it corrects the assumption (Constellations are by delivery route, not size; a high Ember Index is bad). Observed 2026-09-29: both were corrected after a single `search_knowledge` call (the search results include the description, which already carries the correction); for the size question it also said the knowledge base has no term for grouping by size, and offered to search further.

## 4. Judgement: with uses the tools appropriately

### 4.1 Negative control: don't consult for generic work

```bash
demo_run with 'Write a TypeScript function that debounces another function.' --allowedTools mcp__knowledge
```

**Pass:** the TOOLS line is empty and the answer is a normal debounce function.
**Fail:** knowledge calls on a generic coding task mean the `CLAUDE.md` hint is over-triggering.

### 4.2 Unknown term: say "not found", don't invent

```bash
demo_run with 'What does "Quokka rota" mean here?' --allowedTools mcp__knowledge
```

**Pass:** the agent searches (a run on 2026-09-29 tried `Quokka rota`, `Quokka`, and `rota rotation duty schedule`), reports that the knowledge base has no entry, and asks where the term came from. It does not offer a definition, and it does not present The Wheel (the actual rotation concept) as the answer.
**Fail:** a confident definition, or silently mapping the term onto a nearby real concept.

## Recording results

Suggested table for a run (fill in the date, Claude Code version from `claude --version`, and model):

| Test | without | with | Notes |
|---|---|---|---|
| 1.1 Direct reads blocked | | | |
| 1.2 No revealing context | | | |
| 1.3 MCP command line hidden | n/a | | |
| 2 Baseline has no knowledge | | n/a | |
| 3.1 Definitional lookup | n/a | | |
| 3.2 Definition + relationships | n/a | | |
| 3.3 Cross-domain chain | n/a | | |
| 3.4 Disambiguation | n/a | | |
| 4.1 Negative control | n/a | | |
| 4.2 Unknown term | n/a | | |

Status when this doc was written (2026-09-29, Claude Code 2.1.x, one run each): all tests passed as described. These were single runs, so treat them as a spot check, not a guarantee.

## Adding a test

- Keep prompts free of terms you want the agent to learn from the knowledge base, unless the prompt is the thing under test; the `CLAUDE.md` hint and the MCP tool descriptions deliberately use neutral examples ("sprint", "pipeline", `finance/revenue`).
- Decide the pass/fail criteria from the bundle content before running, and judge on the tool calls as well as the answer.
- New knowledge is picked up immediately (the server re-reads the bundle per call). Changes to `mcp-server/src/` need `npm run build`.
