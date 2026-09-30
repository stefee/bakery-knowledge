# OKF metadata automation: specification

**Status:** Reviewed and approved in design. Implemented on branch `okf-metadata-automation` (§18 steps 1 to 8); the §13 rollout has not started. §14 records the questions raised and how they were resolved; none are open.

This specifies how the repo keeps part of the OKF bundle's metadata up to date automatically, from git history, so that humans and agents working through the CMS don't have to. It builds on [SPEC.md](../../open-knowledge-format/SPEC.md) (OKF v0.2).

**Section references:** a bare `§N` refers to a section of *this* document. References to the OKF specification are always written `OKF §N`.

## 0. Handoff notes

This document is meant to be sufficient for an agent with no access to the conversation that produced it. Read it in this order: §1 (what and why), §2 (who owns what), §15 to §16 (git recipes and a worked example, which together pin down the behaviour), then the rest. §17 records alternatives that were considered and **rejected on purpose**; don't reintroduce them without asking the user.

**What is decided:** everything in §1 to §13 and §15 to §18. **What is open:** nothing; §14 records resolved questions. Anything not covered anywhere: ask the user; don't guess.

### Working agreements

These come from the repo's `CLAUDE.md` and the user's preferences, and they apply to this work:

- **Don't commit or push without asking first.** Keep the user in the loop.
- Work happens on the branch `okf-metadata-automation`. The `editing` branch is reserved for content edits made through the CMS: never commit to it, and never push to it without being asked. The repo ruleset `cms writes to editing only` currently locks every other branch on the remote; it is removed as part of this work (§10.3, §13), and pushing this branch has to wait for that.
- Keep `CLAUDE.md` and `docs/` in sync with the change (§11).
- Keep hackathon and bakery-meta wording out of `demos/`.
- **Commit trailers matter to this tool.** `generated.by` is derived from the `Co-Authored-By` trailer (§5.3). An agent committing to this repo must end commit messages with its own trailer, for example `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, or its work will be attributed to the human author.

## 1. Goals and non-goals

### Goals

1. `generated.at` and `generated.by` on every concept are accurate, and cannot drift from what git says.
2. Folder `index.md` files and the bundle `log.md` are always exactly what the concepts imply.
3. The bundle is checked for conformance (OKF §11) and for drift, and a non-conformant or drifting bundle cannot be merged to `main`.
4. One rule covers all of it: **`check` passes if and only if the bundle is conformant and `sync` would change nothing.**

### Non-goals

- `verified`, `sources`, `resource`, `status` and `stale_after` are not automated. `verified` stays human-only: a lint run doesn't confirm content against sources, so writing a `process:` verifier would overstate the trust tier (OKF §5.3). `sources` would leak the hackathon if pointed at `meta/` (see CLAUDE.md).
- The root `index.md` body is not generated (see §6.3).
- No per-folder `log.md` files. Only the root log is generated.
- No semantic validation of concept content (whether a description is true, whether a tag is sensible).

## 2. Ownership of metadata

| Field or file | Owner | Mechanism |
|---|---|---|
| `type`, `title`, `description`, `tags`, `status`, `not`, body | Humans and agents | CMS or direct edit |
| `verified` | Humans (`human:` actors) | CMS |
| `generated.at`, `generated.by` | **CI** | `sync`, derived from git |
| folder `index.md` | **CI** | `sync`, derived from concept frontmatter |
| root `index.md` frontmatter (`okf_version`) | **CI** | `sync`, constant `"0.2"` |
| root `index.md` body | Humans | CMS |
| `log.md` | **CI** | `sync`, derived from git |

Git is the **single source of truth** for everything CI owns. `sync` always overwrites; hand edits to a CI-owned field are lost on the next run.

## 3. Components

| Component | Location | Purpose |
|---|---|---|
| `okf-maintain` | `scripts/okf-maintain/` | Standalone TypeScript package with two commands, `sync` and `check`. |
| `okf-sync.yml` | `.github/workflows/` | Runs both on every push to `editing`. |
| Settings change | `.github/settings.yml` | Makes the `okf-check` status required on `main`. |
| CMS config change | `.pages.yml` | Stops exposing CI-owned files for editing. |

`okf-maintain` is deliberately **not** built on `mcp-server/src/bundle.ts`. The server's parser is lenient by design (OKF §11 says consumers must tolerate bad input) and read-only, whereas this tool must be strict, parse historical revisions, and rewrite a single key while leaving all other bytes untouched. It has its own `package.json`, depends only on the [`yaml`](https://www.npmjs.com/package/yaml) library, and is tested with `node --test` like the server.

### 3.1 Build and layout

The package mirrors `mcp-server/`'s conventions (TypeScript, `tsc` to `dist/`, ESM, `node --test`).

```
scripts/okf-maintain/
  package.json     "type": "module"; scripts: build = tsc, test = tsc && node --test dist/*.test.js
                   dependencies: yaml; devDependencies: typescript, @types/node (same major versions as mcp-server)
  tsconfig.json    copy of mcp-server/tsconfig.json: target ES2022, module/moduleResolution NodeNext,
                   strict, outDir dist, rootDir src
  .gitignore       dist/, node_modules/
  src/             suggested split (not mandatory): cli.ts, git.ts (recipes of §15), content.ts (parse and compare),
                   generated.ts, indexes.ts, log.ts, check.ts, github.ts (login resolver), and *.test.ts beside each
```

- **Runtime:** Node 24 (the version developed against; `mcp-server` declares no `engines`). The workflow uses `actions/setup-node` with `node-version: 24`.
- **Invocation:** `node scripts/okf-maintain/dist/cli.js <command> ...` after `npm ci && npm run build` in the package directory. No global install, no `bin` entry.
- **No other dependencies.** Run git with `child_process.execFile` (never a shell string: paths and commit data are untrusted input), and call the GitHub API with Node's built-in `fetch`.
- **`dist/` and `node_modules/` must be gitignored**, or step 4 of §9.2 would see the build output as a tree change and commit it.
- **The GitHub login resolver is an injectable interface** (`(sha) => Promise<{ login, type } | null>`) so tests never touch the network.

## 4. CLI

```
okf-maintain sync  [--bundle <path>]
okf-maintain check [--bundle <path>] [--offline]
```

- `--bundle` defaults to `$OKF_BUNDLE_PATH`. One of the two is required.
- Both commands read git history of the repository containing the bundle, and require the **full history**. A shallow clone is an error (exit 2).
- Attribution (§5.3) needs the GitHub API. `sync` and `check` read `GITHUB_TOKEN` and `GITHUB_REPOSITORY`, and exit 2 if either is missing, **unless** `check --offline` is passed. `--offline` skips only the resolution of human logins: the `generated.by` comparison is skipped for concepts whose content commit has no `@anthropic.com` co-author trailer, and the output says so. Every other check still runs. `sync` has no offline mode. It is designed to run in CI, but nothing stops a local run with a real token: the output is a pure function of git history, so the result is identical wherever it runs (handy for previewing the diff of §16).
- Exit codes: `0` success (warnings allowed), `1` `check` found errors, `2` usage or environment error (missing token, shallow clone, unreadable bundle).
- Output is human-readable, one finding per line, prefixed with the rule ID from §8. In Actions it also writes a summary to `$GITHUB_STEP_SUMMARY`.
- `sync` is **idempotent**: a second run on its own output changes nothing. This holds because every derived value depends only on git history and concept content, never on the previous value of a derived field.

### 4.1 Discovery

- A *concept* is every `.md` file under the bundle root except `index.md` and `log.md` (OKF §3.1), at any depth.
- Only files tracked by git are considered. Untracked files and files with uncommitted changes are skipped with a notice (locally only; CI checks out a clean tree).
- Line endings are normalised to LF when comparing and when writing generated files. Generated files end with exactly one newline.

## 5. `generated`

### 5.1 The content commit

A concept's **content** is its frontmatter, parsed as YAML and minus the keys `generated` and `verified`, together with its body.

The **content commit** of a concept is the newest commit, in history order (`git log --topo-order` walking back from `HEAD`, **not** sorted by date), at which the concept's content differs from its content at that commit's parent. The commit that first adds the file also counts. Exact git commands are in §15.

Rules:

- **Comparison is on parsed content.** Frontmatter is compared as parsed values, deep-equal, so key order, quoting and whitespace don't matter. Body text is compared after normalising line endings to LF, stripping trailing whitespace from each line, and trimming leading and trailing blank lines.
- **`generated` is excluded**, so the bot's own commits never count as content changes, which is what makes `sync` idempotent.
- **`verified` is excluded.** A human signing off isn't a content change, and `verified` is independent of `generated.at` (OKF §5.2). Without this, verifying a concept would make it look freshly generated and would credit the reviewer as its author.
- **Renames and moves are followed** (`git log --follow`), so moving a concept between folders doesn't reset its history.
- **Merge commits are ignored.** Only non-merge commits can be content commits.
- **An unparseable revision** (invalid YAML) is treated as different from its neighbours, and is reported as a warning (`W2`).

### 5.2 `generated.at`

The **author date** of the content commit, converted to UTC and written as `YYYY-MM-DDTHH:MM:SSZ`.

The author date is the time the change was originally written. The committer date is when the commit was last applied to a branch, and it changes on rebase, cherry-pick and amend; using it would rewrite `generated.at` for every touched concept if `editing` were ever rebased. For ordinary commits the two are identical.

### 5.3 `generated.by`

An actor string (OKF §7), decided in this order from the content commit:

1. **Agent.** If the commit has a `Co-Authored-By` trailer whose email is at exactly `anthropic.com`, the value is `claude-code/<slug>`, where `<slug>` is the trailer's display name lower-cased with each run of non-alphanumeric characters replaced by a single `-`, and leading and trailing `-` trimmed. `Claude Sonnet 5.5` becomes `claude-code/claude-sonnet-5-5`. If there are several such trailers, the first is used. The agent wins even when a human is the commit's author, because the agent wrote the content. Detection is by email domain, not by name.
2. **Human.** Otherwise the value is `human:<login>`, where `<login>` is `author.login` from the GitHub API for the commit (`GET /repos/{repo}/commits/{sha}`), so it works for Pages CMS commits and for commits whose git email isn't a noreply address. If GitHub reports the author's account type as `Bot`, the value is `process:<login>` instead.
3. **Unresolvable.** If the API returns no author (the commit email isn't linked to any GitHub account), attribution is **unresolvable**. `sync` leaves that concept's `generated` key untouched and continues; `check` reports error `E12`. The bundle cannot be merged until the commit author links their email to their account and the workflow is re-run with `workflow_dispatch` (nothing needs to be recommitted, because everything is recomputed from history). If the email can never be linked, the only remedy is rewriting history.

This is deliberately stricter than OKF §11, which treats trust metadata as optional. It is a rule of this bundle, not a conformance requirement.

The API is called once per distinct content commit that needs a human login, and results are cached for the run.

### 5.4 Output format

`sync` writes the value as a flow mapping, matching the existing files:

```yaml
generated: { by: claude-code/claude-sonnet-5-5, at: 2026-09-29T10:22:51Z }
```

`sync` edits the frontmatter with the `yaml` library's document API and replaces only the `generated` key. If the key exists it is replaced in place, keeping its position. If absent it is appended at the end of the frontmatter. All other frontmatter and the entire body are left byte-for-byte unchanged. `sync` never reformats a file whose `generated` already has the correct value.

## 6. Index files

### 6.1 Folder `index.md`

Every directory under the bundle root (excluding the root itself) gets an `index.md`, fully regenerated. It has no frontmatter (OKF §8).

- Concepts directly inside the directory are grouped under a `# <type>` heading using the `type` value verbatim. Groups are sorted alphabetically by type, case-insensitively.
- Within a group, entries are sorted by title (falling back to the filename without `.md` when `title` is absent), case-insensitively.
- An entry is `* [<title>](<file>.md) - <description>`, with the link relative to the folder. The ` - <description>` part is omitted if the concept has no `description`. Descriptions have runs of whitespace collapsed to a single space.
- Subdirectories are listed last under `# Subdirectories` as `* [<name>](<name>/index.md)`. A folder cannot carry a description (index files have no frontmatter), so none is written.
- A directory containing no concepts and no subdirectories gets no index, and an existing one is deleted.

The first `sync` will rewrite the existing folder indexes where their wording differs from the concept `description`. The current indexes use hand-shortened descriptions, so the regenerated ones are noticeably longer (see §16).

### 6.2 Root `index.md` frontmatter

`sync` ensures the frontmatter contains `okf_version: "0.2"`, adding or correcting it. Other frontmatter keys are a `check` error (`E5`). The version is a constant in the script; bumping OKF versions is a code change.

### 6.3 Root `index.md` body

**Not generated.** Its per-domain descriptions describe folders, which have no frontmatter to derive a description from, so they are hand-written and editable in the CMS. `sync` never touches the body. `check` requires every top-level directory of the bundle to be linked from it (`E10`), matched by a link target of `<dir>/` or `<dir>/index.md`, so a new domain cannot be forgotten.

### 6.4 Impact on the MCP server and demos

The MCP server's `list_knowledge` tool returns the raw text of a directory's `index.md` followed by its own list of concepts with their full descriptions (`mcp-server/src/server.ts`). Regenerated indexes therefore change what the agent in the `with-knowledge` demo sees: same information, longer descriptions. No server code changes are needed, and the server's tests build their own fixtures and don't depend on the real bundle's index content. After the first sync, re-run the grounding checks in `docs/testing-the-demos.md`.

## 7. `log.md`

The root `log.md` is fully regenerated from git on every `sync`. No hand-written content survives. It follows OKF §9:

```markdown
# Directory Update Log

## 2026-09-29
* **Initialization**: Created the bundle.
* **Creation**: [Ember Index](/bakehouse/ember-index.md)
* **Update**: [Kettle Process](/bakehouse/kettle-process.md)
```

- **Sections:** one `## YYYY-MM-DD` per UTC day on which anything happened, newest first. The day is that of the commit's author date.
- **Entries**, one per concept per day, derived from the content-change history of §5.1 across the whole of history:
  - **Creation**: the content commit that first introduced the concept.
  - **Update**: any later content commit.
  - **Deprecation**: a content commit that sets `status: deprecated` where it wasn't before. Used instead of Update.
  - **Removal**: a commit that deletes the concept's file without a rename to another path (git rename detection). The entry can't link to a file that no longer exists, so it reads `* **Removal**: <last known title> (` + `` `<path>` `` + `)`.
  - If a concept has several events in one day, one bullet is written, with the precedence Creation, then Removal, then Deprecation, then Update.
- **Initialization:** one `* **Initialization**: Created the bundle.` bullet on the day of the first commit that added any file to the bundle directory.
- **Order within a day:** Initialization first, then Creation, Update, Deprecation, Removal, then alphabetically by concept path.
- Links are bundle-absolute (`/bakehouse/ember-index.md`) and point at the concept's path at `HEAD`, so a concept renamed later is still linked correctly. The title shown is the concept's current title.
- A concept that **no longer exists at `HEAD`** (it was later removed) can't be linked. Its Creation and Update entries are written like Removal: the title as of that commit, then the path in backticks, with no link.
- Changes to index files, to `log.md` itself, or to `generated` and `verified` alone are not logged. A pure move (rename with unchanged content) is not logged either.
- A file deleted and later re-added at the same path is a **new concept**: a Removal, then a Creation.
- A rename whose content similarity falls below git's rename threshold (50% by default) appears to git as a delete plus an add, so it is logged as a Removal and a Creation. This is a known limitation.

The first `sync` replaces the existing hand-written log, which currently has one combined Creation line and an Initialization line.

## 8. `check`

`check` reads the working tree and fails on the following. It does not write anything.

| ID | Level | Condition |
|---|---|---|
| `E1` | error | A concept has no frontmatter, or it is not valid YAML (OKF §11.1). |
| `E2` | error | A concept's `type` is missing or empty (OKF §11.2). |
| `E3` | error | A folder `index.md` has frontmatter (OKF §8). |
| `E4` | error | `log.md` does not follow OKF §9: missing `# ` title, a `## ` heading that isn't an ISO `YYYY-MM-DD` date, or dates not in newest-first order. |
| `E5` | error | The root `index.md` has frontmatter keys other than `okf_version`. |
| `E6` | error | `generated` is malformed: not a mapping with both keys, `by` not an actor string (OKF §7), or `at` not an ISO 8601 UTC datetime with an explicit offset. |
| `E7` | error | `generated` differs from what `sync` would write, or is missing. |
| `E8` | error | A folder `index.md` differs from what `sync` would write, or is missing or unexpected. |
| `E9` | error | `log.md` differs from what `sync` would write. |
| `E10` | error | A top-level directory isn't linked from the root `index.md` body. |
| `E11` | error | The root `index.md` is missing `okf_version: "0.2"`, or has a different value. |
| `E12` | error | Attribution is unresolvable (§5.3). Not evaluated with `--offline` for human commits. |
| `W1` | warning | A markdown link to a concept (bundle-absolute or relative) targets a file that doesn't exist. Broken links are tolerated by the spec (OKF §6.1), as they may be not-yet-written knowledge. External URLs and `#` anchors are ignored. |
| `W2` | warning | A historical revision of a concept has invalid YAML, so its content commit may be imprecise. |

`E7` through `E9` and `E11` are *drift*: `check` computes the `sync` result in memory and compares it with the working tree. Immediately after a successful `sync`, none of them can occur. They exist to catch a rejected push, a script bug, or a hand edit to a CI-owned file.

## 9. Workflow: `okf-sync.yml`

### 9.1 Trigger and guards

The workflow has two jobs, selected by the event:

| Job | Runs on | Purpose | `permissions` |
|---|---|---|---|
| `sync` | `push` to `editing`; `workflow_dispatch` (to re-run after an author links their email) | Sync, commit, check, post status (§9.2) | `contents: write`, `statuses: write` |
| `check-pr` | `pull_request` targeting `main`, **except** when the head branch is `editing` | Check only, post status (§9.4) | `contents: read`, `statuses: write` |

- **No `paths:` filter** on either trigger. The `okf-check` status must exist on every head commit that can be merged; a filter would leave one without a status and the required check would wait forever.
- `sync` runs only on `editing` (for `workflow_dispatch`: `if: github.ref == 'refs/heads/editing'`). `check-pr` is skipped when `github.head_ref == 'editing'`: a PR from `editing` already has its status from the push run, and `open-editing-pr` creates that PR with `GITHUB_TOKEN`, which would not trigger a `pull_request` run anyway.
- `concurrency` with `cancel-in-progress: true`. The group is `okf-sync-editing` for `sync` and `okf-check-pr-<PR number>` for `check-pr`. A newer event cancels an older run in the same group.

### 9.2 Steps

1. Check out `editing` with `fetch-depth: 0`.
2. Install the tool (`npm ci` in `scripts/okf-maintain/`).
3. Run `okf-maintain sync`.
4. If the bundle directory changed (`git status --porcelain -- <bundle>`), stage **only the bundle directory**, commit as `github-actions[bot]` (email `41898282+github-actions[bot]@users.noreply.github.com`) with the message `Sync OKF metadata`, and push to `editing` **without force**.
   - If the push is rejected as a non-fast-forward (a CMS save landed mid-run), **exit successfully without retrying and without posting a status.** The newer push triggers its own run, which derives the same result from the newer history.
   - The bot's push is made with `GITHUB_TOKEN` and therefore doesn't trigger another run, so there is no loop.
5. Run `okf-maintain check`.
6. Post a commit status, context `okf-check`, to the **final head SHA** (the bot's commit if it made one, otherwise the triggering commit): `success` if `check` exited 0, `failure` otherwise, with a link to the run. The job then fails if `check` failed.

### 9.3 Interactions and caveats

- A workflow run by `push` uses the workflow file **on `editing`**. After this lands on `main`, `main` must be **merged into `editing` by hand** for it to take effect, and again whenever the workflow or script changes.
- Sync runs on every CMS save, so `editing` always carries current metadata. It also means each save is followed by a bot commit.
- The bot commit touches only CI-owned content, so it is never itself a content commit (§5.1).
- Because `dismiss_stale_reviews` is enabled on `main`, a bot commit pushed after a PR was approved would dismiss the approval. In practice sync runs on each CMS save, before the PR is reviewed.
- A CMS save can fail on a stale file SHA if it lands between the bot's push and the CMS's read; the user retries.
- The `okf-check` status is an ordinary commit status, so anyone who can write to `editing` could post one. Review of the PR diff, including any change to the script or workflow, is the control. This is no weaker than the existing arrangement.

### 9.4 `check-pr`: PRs from other branches

Once `okf-check` is required on `main`, every PR needs that status, including PRs from branches other than `editing` (for example tooling or docs changes). `check-pr` provides it:

1. Check out the PR **head commit** (`ref: ${{ github.event.pull_request.head.sha }}`, not the default merge ref) with `fetch-depth: 0`.
2. Install the tool, then run `okf-maintain check` (no `sync`, no commit, no push).
3. Post the `okf-check` status to `github.event.pull_request.head.sha`, as in §9.2 step 6. The job fails if `check` failed.

Consequences:

- A PR that doesn't touch the bundle passes as long as `main`'s bundle is itself synced, so tooling and docs PRs merge normally.
- A PR that changes knowledge content fails on drift (`E7` to `E9`), because `generated`, the indexes and the log are only written by `sync` on `editing`. This is intended: content goes through the CMS and `editing`.
- Before the first sync has reached `main`, `check` fails on any PR, including the tooling PR itself. That is expected and harmless because the check isn't required yet (§13).
- Because `pull_request` runs use the workflow file from the PR, workflow changes are exercised by their own PR.
- PRs from forks get a read-only token and cannot post the status. Fork PRs are out of scope.

## 10. Repo configuration changes

### 10.1 `.github/settings.yml`

Add `okf-check` to `main`'s required status checks:

```yaml
required_status_checks:
  strict: false
  contexts: [okf-check]
```

This matches the Settings app's schema for branch protection (checked against its docs): `strict` and `contexts` are both required under `required_status_checks`, and every top-level protection key must be present (set to `null` to disable), which the file already does. Today `required_status_checks` is `null`, so nothing is gated.

### 10.2 `.pages.yml`

- Remove the `log`, `bakehouse-index`, `wholesale-round-index` and `shop-and-customer-line-index` entries. Pages CMS has no read-only option, so hiding is the only way to stop edits that the next sync would overwrite. The files remain readable on GitHub and through the MCP server.
- Keep `root-index`, and note in the description of `okf_version` that CI maintains it.
- Keep `generated` unexposed, and replace the header comment's explanation (currently "deliberately covers only a subset") with the real one: it is written by CI from git history.
- Pages CMS caches `.pages.yml` per branch. After this reaches `editing`, the cache only refreshes once someone saves through the CMS Configuration page; until then the removed entries may still appear.

### 10.3 Ruleset: allow every branch except `main`

Remove the `cms writes to editing only` ruleset from `.github/settings.yml`, so that branches other than `main` can be created and pushed freely. `main` stays protected by branch protection (a PR and one approval, enforced for admins), which is what actually guards it.

What this gives up: the CMS token is no longer confined to `editing`, and force-push and deletion are possible on every non-`main` branch (they already were on `editing`). A pushed branch can carry its own workflows, and so could forge the `okf-check` status. Anyone with write access could already do both on `editing`, and the PR approval remains the control.

Two practical points:

- The Settings app's rulesets support is marked as under development, and its docs don't say whether removing a ruleset from `settings.yml` also deletes it on GitHub. After the change merges, check GitHub's Rules settings and delete the ruleset by hand if it lingers. The ruleset must be gone **before** this branch can be pushed, so it is deleted by hand first (§13), and removed from `settings.yml` in the same PR so the app doesn't recreate it.
- Because the workflow's `check-pr` job (§9.4) covers PRs from other branches, no other branch needs a status from `sync`.

## 11. Documentation changes

- `CLAUDE.md`: add `scripts/okf-maintain/` and `okf-sync.yml` to the project structure, and a short "Metadata maintenance" section stating what CI owns.
- New `docs/metadata-maintenance.md`: the operational guide (what CI writes, how to fix `E12`, how to merge `main` into `editing`, the cache caveat). This spec stays as the design record.
- Note in the docs that attribution enforcement is stricter than the OKF spec.
- Agents must stop hand-writing `generated` in new concepts. It can be omitted; `sync` adds it.
- `docs/testing-the-demos.md` and `docs/running-the-demos.md`: add a note that the regenerated indexes change `list_knowledge` output (§6.4).
- `CLAUDE.md` describes `.github/settings.yml` as locking every branch except `editing` and `main`. Update it for §10.3, and mention `okf-check` once it is required.
- `CLAUDE.md` currently says concepts "are `generated` by Claude". Reword it to say `generated` is maintained by CI from git history.

## 12. Testing

`scripts/okf-maintain/` tests use `node --test`, run against throwaway git repositories built in a temp directory, with commits created at controlled author dates and with controlled trailers. The GitHub API is replaced by an injectable resolver.

- **Content commit:** a body edit counts; a `verified`-only change doesn't; a `generated`-only change doesn't; a whitespace or key-order change doesn't; a rename follows history; merge commits are ignored; the first commit counts; out-of-order author dates still choose by history order.
- **`generated.by`:** Anthropic trailer beats a human author; slugging (`Claude Sonnet 5.5`); a non-Anthropic trailer is ignored; human login resolution; `Bot` becomes `process:`; unresolvable login leaves the key untouched and produces `E12`.
- **`generated.at`:** author date is used when it differs from the committer date; UTC conversion from a non-UTC offset.
- **Rewriting:** only the `generated` key changes; other bytes are identical; existing position is preserved; appended when absent; no rewrite when already correct.
- **Indexes:** grouping, sorting, missing title or description, subdirectories, empty directory removal; root `okf_version` added or corrected while the body is preserved.
- **Log:** each entry kind, precedence within a day, ordering, rename linking, removal, initialization; regenerating twice yields identical output.
- **Idempotence:** `sync` then `sync` produces no diff, and `check` passes after `sync` on a fixture repository.
- **`check`:** one test per rule `E1` to `E12` and `W1`, `W2`; exit codes; `--offline` behaviour; shallow clone rejected.
- **Workflow:** not unit-tested. It is verified once by hand during rollout (§13).

## 13. Rollout

1. Remove the `cms writes to editing only` ruleset **by hand** on GitHub (admin: Settings, Rules; or `gh api -X DELETE repos/<owner>/<repo>/rulesets/<id>`), because it blocks pushing `okf-metadata-automation`. This is outward-facing, so it needs the user's explicit go-ahead. Then push the branch and open a PR to `main`. The PR also removes the ruleset from `settings.yml` (§10.3) so the Settings app doesn't recreate it.
2. Merge the tooling **without** the required-check change in `settings.yml`. The PR's own `okf-check` status (from `check-pr`) will be red, because the bundle isn't synced yet. That is expected and doesn't block the merge, because the check isn't required.
3. Merge `main` into `editing`. The push triggers the workflow; verify that it syncs the bundle and posts `okf-check`. The expected result of that first run is the diff in §16; review the actual diff against it.
4. Open the `editing` to `main` PR, review the regenerated metadata, and merge.
5. In a follow-up PR, add `okf-check` to the required checks (§10.1).
6. After the first sync reaches `editing`, refresh the Pages CMS configuration cache (§10.2).

## 14. Open questions

1. **Delivering the branch to GitHub.** *Resolved:* remove the `cms writes to editing only` ruleset so every branch except `main` can be pushed (§10.3). `main` remains protected by branch protection. PRs from other branches get their `okf-check` status from the `check-pr` job (§9.4).
2. **Bot accounts.** *Resolved:* `Bot` logins map to `process:<login>` (§5.3).
3. **Local `sync`.** *Resolved:* allowed. "CI-only" is a convention, not enforced (§4).

## 15. Git recipes

These commands were run against this repository and against a throwaway repository containing a rename with an edit, a delete, a `verified`-only change, a non-UTC author date that differs from the committer date, and an Anthropic co-author trailer. They behaved as described. `<bundle>` is the bundle directory (`knowledge/hearth-and-wheel`).

**Preconditions.** `git rev-parse --is-shallow-repository` must print `false`, otherwise exit 2.

**Dates.** Read the author date with `--format=%aI` (strict ISO 8601 with the author's offset, for example `2026-09-29T11:41:53+01:00`) and convert it to UTC in code. Don't depend on the `TZ` environment variable.

**Reading a file at a revision.** `git show <sha>:<path>`. Use `<sha>^:<path>` for the parent's version. A root commit has no parent, and its status is `A` anyway.

**Trailers.** `git log -1 --format='%(trailers:key=Co-Authored-By,valueonly)' <sha>` prints one trailer value per line, for example `Claude Sonnet 5.5 <noreply@anthropic.com>`. Parse each line with `^(.*) <([^>]+)>$`. Git matches the key case-insensitively.

### 15.1 History of a live concept (for `generated`)

```
git log --follow --no-merges --topo-order -M --name-status --format='@%H|%aI' -- <path-at-HEAD>
```

Output is newest first: a header line `@<sha>|<author-iso>`, then one status line, tab-separated: `A<TAB>path`, `M<TAB>path`, or `R<similarity><TAB>old-path<TAB>new-path` (for example `R094`). `--follow` handles only one path at a time and follows renames across the listed commits.

For each commit, newest first, compare the concept's content (§5.1) at `<sha>:<path>` with `<sha>^:<old-path>` (same path unless the record is `R`). The first commit where they differ, or whose status is `A`, is the content commit. A pure move (`R100`, or an `R` with unchanged content) is skipped.

In the throwaway repository, a `verified`-only commit and a rename-plus-edit commit were listed as `M` and `R094` respectively, and the `verified`-only one compared equal and was skipped, as required.

### 15.2 Whole-bundle walk (for `log.md`)

```
git log --no-merges --topo-order -M --name-status --format='@%H|%aI' -- <bundle>
```

Same record format, for every path in the bundle. Ignore everything except concept paths (`.md`, not `index.md` or `log.md`). Each commit is judged **against its own parent**, never against the previously processed commit, so interleaved branches can't produce wrong comparisons. For each concept record:

| Status | Event |
|---|---|
| `A` | **Creation** |
| `M` | compare `<sha>:<path>` with `<sha>^:<path>`; if the content differs, **Update** (or **Deprecation**, if `status` is now `deprecated` and wasn't before); otherwise nothing |
| `R` | compare `<sha>:<new>` with `<sha>^:<old>`; if the content differs, **Update** or **Deprecation** as above; otherwise nothing (a pure move) |
| `D` | **Removal**; the title comes from `<sha>^:<path>` |

**Mapping to `HEAD` paths.** Walking newest to oldest, keep a map from path to path-at-`HEAD`. It starts as the identity for paths that exist at `HEAD`. On an `R old new` record, set `map[old] = map[new] ?? new`. An event's concept key is `map[path]` (or the path itself for a removed concept).

**Initialization.** The first commit that added any file under the bundle (oldest in history order):

```
git log --no-merges --topo-order --reverse --diff-filter=A --format='%aI' -- <bundle>
```

Take the first line. (`git log -1 --reverse` would not work, because `-1` is applied before `--reverse`.)

Merge commits are skipped, so content that enters history only through a merge commit's conflict resolution is invisible to this tool. Commits on merged branches are ordinary non-merge commits and are counted.

### 15.3 Resolving a GitHub login

`GET https://api.github.com/repos/{owner}/{repo}/commits/{sha}` with the token. Use `author.login` and `author.type`. `author` is `null` when the commit email isn't linked to an account (unresolvable, §5.3). Verified for this repo's existing CMS commits: they resolve to login `stefee` even though the git email isn't a noreply address.

## 16. Worked example

This is what the first `sync` should produce for the repository as of commit `7df35a7` (before this work). It's the acceptance test for §5 to §7, and the expected diff to review at step 3 of §13.

### 16.1 Facts from history

Only two commits touch the bundle, both authored by `Stef <git@sril.email>` and both carrying `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`:

| Commit | Author date | What it did |
|---|---|---|
| `3db1e4f` | `2026-09-29T11:41:53+01:00` (= `10:41:53Z`) | Added all twelve files in the bundle |
| `333790a` | `2026-09-29T12:01:30+01:00` | Changed **only** the `generated` line of each of the seven concepts |

`333790a` is not a content commit (its only diff is the `generated` line: `at: 2026-09-29T12:00:00Z` to `at: 2026-09-29T10:22:51Z`). So the content commit of all seven concepts is `3db1e4f`. Both commits carry the Anthropic trailer, so no GitHub API call is needed for this history.

### 16.2 `generated` on all seven concepts

Every concept gets `generated: { by: claude-code/claude-sonnet-5-5, at: 2026-09-29T10:41:53Z }`. `by` is unchanged; `at` changes from `10:22:51Z` to `10:41:53Z`. For `ember-index.md`, the only change in the file is:

```diff
-generated: { by: claude-code/claude-sonnet-5-5, at: 2026-09-29T10:22:51Z }
+generated: { by: claude-code/claude-sonnet-5-5, at: 2026-09-29T10:41:53Z }
```

### 16.3 Folder indexes

`bakehouse/index.md`:

```markdown
# Metric

* [Ember Index](ember-index.md) - A 0-100 score generated from oven temperature logs showing how stable the wood-fired oven's heat was overnight; a high score is bad.

# Process

* [The Kettle Process](kettle-process.md) - The bakery's overnight sourdough routine, in which starter is fed and dough proves for about 14 hours in a steam-kettle-humidified cabinet before shaping and baking.

# System

* [Nightwatch](nightwatch.md) - The overnight monitoring setup, temperature probes plus a duty baker, that watches the oven and proving cabinets, calculates the Ember Index, and flags anomalies in real time.
```

`wholesale-round/index.md`:

```markdown
# Concept

* [Constellations](constellations.md) - The groupings used to organise wholesale cafe customers by delivery route, not by size or order volume.

# Schedule

* [The Wheel](the-wheel.md) - The weekly delivery rotation board showing which constellations receive bread on which days, and in what delivery order.

# Status

* [Looming](looming.md) - The status of a wholesale account whose standing order is approaching renewal or renegotiation, for example a 3-month bread supply agreement.
```

`shop-and-customer-line/index.md`:

```markdown
# AI Agent

* [Michael](michael.md) - Hearth & Wheel's customer-facing AI telephone assistant, styled and voiced on TV presenter Michael McIntyre, who answers the bakery's public phone line.
```

### 16.4 `log.md`

```markdown
# Directory Update Log

## 2026-09-29
* **Initialization**: Created the bundle.
* **Creation**: [Ember Index](/bakehouse/ember-index.md)
* **Creation**: [The Kettle Process](/bakehouse/kettle-process.md)
* **Creation**: [Nightwatch](/bakehouse/nightwatch.md)
* **Creation**: [Michael](/shop-and-customer-line/michael.md)
* **Creation**: [Constellations](/wholesale-round/constellations.md)
* **Creation**: [Looming](/wholesale-round/looming.md)
* **Creation**: [The Wheel](/wholesale-round/the-wheel.md)
```

The day is `2026-09-29` in UTC (`10:41:53Z`). Concepts are ordered by path within the day (§7). As in the existing file, there is a blank line after the `#` title and between sections, but none after a `##` heading.

### 16.5 Unchanged

The root `index.md` (its body is hand-written and already lists all three folders, and `okf_version: "0.2"` is present). `check` then passes with no errors; there are no broken links in the current bundle.

## 17. Decisions and rejected alternatives

Each row is something the user decided after comparing options. The rejected column says what was not chosen and why, so it isn't reintroduced.

| Topic | Decided | Rejected, and why |
|---|---|---|
| Source of truth for `generated` | Git; `sync` always overwrites | Fill-if-missing or fill-if-stale: respects hand-set values but lets `generated.at` be wrong whenever an author forgets. |
| What counts as a content change | Parsed comparison, excluding `generated` and `verified` | Last commit that touched the file: a `verified` edit or whitespace fix would make the reviewer the author and reset `at`. |
| Which date | Author date | Committer date: changes on rebase, cherry-pick and amend. |
| Commit ordering | History order (`--topo-order`) | Sorting by date: author dates can go backwards after cherry-picks or from clock skew. |
| Human identity | GitHub login from the API | Git email to id mapping file (another file to maintain); lower-cased author name (not a real id). |
| Agent identity | Slugify the `Co-Authored-By` display name, keyed on the `@anthropic.com` email | A dedicated `Generated-By` trailer: exact, but agents would forget to add it. |
| Unresolvable attribution | `check` error (`E12`) | Warn and skip: originally recommended, then overridden by the user to be stricter ("less hackathon-ey"). |
| Drift | Error | Warning: only made sense before the status was posted on the final head SHA. |
| `log.md` | Fully regenerated from git, root only | Append-only with hand-written entries preserved: needs fragile "already logged" tracking. |
| Root `index.md` body | Hand-written; `check` enforces folder coverage | A sidecar config of folder descriptions (content outside the bundle, not CMS-editable); a hidden per-folder concept (pollutes search). |
| Parser | Standalone package with its own small parse | Reusing `mcp-server/src/bundle.ts`: couples two packages, and the server's parser is lenient, read-only and can't preserve formatting. |
| Trigger | `push` to `editing` (user's preference) | Dispatch from `main` as a second Pages CMS action, which would avoid merging `main` into `editing` by hand but wouldn't keep metadata current on every save. |
| Merge gating | Commit status `okf-check` posted to the final head SHA, required on `main` | Advisory-only check (gates nothing); a PAT or GitHub App token so the bot's push retriggers a normal check workflow (an extra secret to manage). The status is needed because a `GITHUB_TOKEN` push doesn't trigger workflows, so the bot's commit would otherwise have no status. |
| Concurrency | `cancel-in-progress: true`; exit quietly on a rejected push | Rebase-and-retry loop: the retry logic is the likeliest source of bugs, for no gain since runs are idempotent. |
| CMS | Remove generated files from `.pages.yml` | Keep them editable: edits would be overwritten by the next sync. |
| `verified` | Never automated | A `process:` verifier for lint: lint doesn't confirm content against sources, so it would overstate trust (OKF §5.3). |
| Scope cut | `stale_after` is out of scope | (User dropped it from the proposal.) |
| Branch rules | Remove the ruleset; every branch except `main` is writable | Keeping the ruleset with a `dev/*` exclusion, a temporary exclusion for this branch, or delivering through `editing`: each keeps the CMS confined, but none is needed since `main` is protected by review and they get in the way of ordinary dev branches. |
| PRs from other branches | `check-pr` job: check only, posts `okf-check` on the PR head | Leaving them without a status: once `okf-check` is required, no PR from a non-`editing` branch could ever merge. |
| Bot authors | `process:<login>` | Treating bot logins as unresolvable (`E12`): stricter, but no bot is expected to author knowledge. |
| Local `sync` | Allowed with a real token | Refusing unless `GITHUB_ACTIONS=true`: the result is identical anywhere, so a guard adds nothing. |
| Workflow path filter | None | `paths: knowledge/**`: leaves head commits without a status, which blocks the required check forever. |

## 18. Suggested build order

Each step should leave `npm test` green and be committed only when the user says so.

1. **Package skeleton and content parsing:** frontmatter split, YAML parse, content equality per §5.1, and body normalisation. Tests: the equality rules.
2. **Git recipes (§15):** history, rename and deletion walking, dates, trailers, shallow detection. Tests against throwaway repositories with controlled dates.
3. **`generated` (§5):** attribution, the injectable resolver, and the key-only rewrite that leaves all other bytes unchanged.
4. **Indexes (§6)** and root `okf_version`.
5. **Log (§7).**
6. **`check` (§8)** with every rule ID, plus `--offline` and exit codes. Idempotence test: `sync` then `sync` produces no diff, and `check` passes.
7. **Golden test:** a fixture repository reproducing the two commits of §16.1, asserting the exact files of §16.
8. **Workflow, `settings.yml` and `.pages.yml` changes,** and the docs of §11. Verify the workflow by hand per §13.
