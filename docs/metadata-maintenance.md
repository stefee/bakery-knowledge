# Metadata maintenance

CI keeps part of the OKF bundle's metadata up to date from git history, so people and agents working through the CMS don't have to. This is the operational guide; the design record (and the reasons behind each choice) is [`specs/metadata-automation.md`](specs/metadata-automation.md).

## What CI writes

| Owned by CI (hand edits are overwritten) | Derived from |
|---|---|
| `generated.at` and `generated.by` on every concept | The commit that last changed the concept's content: its author date, and its `Co-Authored-By` trailer (`claude-code/<model>`) or else the GitHub login of its author (`human:<login>`) |
| Folder `index.md` files | Concept frontmatter (`type`, `title`, `description`) |
| `log.md` | The git history of the bundle |
| `okf_version` in the root `index.md` | A constant (`"0.2"`) |

Humans and agents own everything else, including `verified` (never automated) and the body of the root `index.md` (hand-written; `check` only requires it to link every top-level folder). **New concepts can omit `generated`; CI adds it.** Agents must not hand-write it.

Changes to `verified` or `generated` alone don't count as content changes, so signing off a concept doesn't make the reviewer its author.

**Commit trailers matter.** An agent committing to this repo must end its commit messages with its own `Co-Authored-By: <Name> <noreply@anthropic.com>` trailer, or the work is attributed to the human author. Attribution is detected by the `@anthropic.com` email domain.

## How it runs

`.github/workflows/okf-sync.yml`:

- **Push to `editing`** (every CMS save): `okf-maintain sync`, commit the result as `github-actions[bot]` (`Sync OKF metadata`, never forced), then `okf-maintain check`, then post the `okf-check` commit status on the final head commit. If a CMS save lands mid-run the push is rejected and the run exits quietly; the newer push has its own run.
- **Pull request to `main` from any other branch**: `check` only, posting `okf-check` on the PR head. PRs that don't touch the bundle pass as long as `main` is synced; a PR that edits knowledge content fails on drift, by design (content goes through the CMS and `editing`).
- **`workflow_dispatch`** on `editing`: re-runs sync (see E12 below).

`check` passes if and only if the bundle is conformant and `sync` would change nothing. Once `okf-check` is required on `main` (see Rollout), a failing bundle can't be merged.

## Running it locally

```
cd scripts/okf-maintain && npm install && npm run build
GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=<owner>/<repo> \
  node dist/cli.js sync --bundle ../../knowledge/hearth-and-wheel     # or set OKF_BUNDLE_PATH
node dist/cli.js check --bundle ../../knowledge/hearth-and-wheel --offline
```

The output is a pure function of git history, so a local `sync` produces the same result as CI; it's handy for previewing a diff. It needs the full history (a shallow clone exits 2) and a clean view of what's committed: untracked files and concepts with uncommitted content changes are skipped with a notice. `--offline` (check only) skips resolving human logins. Tests: `npm test`. Exit codes: `0` ok, `1` `check` found errors, `2` usage or environment error.

## Rules `check` enforces

`E1` to `E12` are errors, `W1` and `W2` warnings; the full table is in spec §8. The ones you'll actually meet:

- **E7 to E9, E11 (drift)**: `generated`, an index, `log.md` or `okf_version` differs from what `sync` would write. Run `sync` (or push to `editing` and let CI do it).
- **E12 (attribution unresolvable)**: the content commit's author email isn't linked to any GitHub account and there's no Anthropic trailer, so the GitHub API returns no author. The bundle can't merge until the author adds that email to their GitHub account (Settings, Emails); then re-run the workflow with `workflow_dispatch` on `editing`. Nothing needs recommitting, everything is recomputed from history. If the email can never be linked, the only remedy is rewriting history. This is deliberately stricter than OKF §11, which treats trust metadata as optional.
- **W1**: a link to a concept that doesn't exist. Tolerated by the OKF spec (it may be not-yet-written knowledge), so it only warns.

## Operational notes

- **Merge `main` into `editing` by hand** after the workflow or `scripts/okf-maintain/` changes: a `push` run uses the workflow file on `editing`.
- **Each CMS save is followed by a bot commit.** A CMS save can fail on a stale file SHA if it lands between the bot's push and the CMS's read; retry.
- **Pages CMS caches `.pages.yml` per branch.** After a config change reaches `editing`, removed entries (`log`, the folder indexes) keep showing until someone saves through the CMS Configuration page.
- **The `okf-check` status is an ordinary commit status**, so anyone who can write to a branch could post one. Review of the PR diff, including any change to the script or workflow, is the control.
- **A bot commit after approval dismisses the approval** (`dismiss_stale_reviews`). In practice sync runs on each CMS save, before review.
- **Regenerated indexes change what the agent sees.** The MCP server's `list_knowledge` returns the raw folder `index.md` plus its own list of concepts, so the index now carries the full concept `description`s (longer than the old hand-shortened ones). After a sync reaches `main`, re-run the grounding checks in [`testing-the-demos.md`](testing-the-demos.md).

## Rollout

Spec §13: delete the `cms writes to editing only` ruleset on GitHub by hand (it blocks pushing feature branches; `.github/settings.yml` no longer declares it), push and merge the tooling (the PR's own `okf-check` is red until the bundle is synced, which doesn't block because the check isn't required yet), merge `main` into `editing`, review and merge the resulting `editing` PR, then add `okf-check` to `required_status_checks` in `.github/settings.yml` (`strict: false`, `contexts: [okf-check]`) in a follow-up PR and refresh the CMS config cache.
