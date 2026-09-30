import { Git, HistoryRecord, toUtc } from "./git.js";
import { contentKey, parseConcept, setKey, sameContent } from "./content.js";

export type Resolver = (sha: string) => Promise<{ login: string; type: string } | null>;

export interface ContentCommit {
  sha: string;
  authorIso: string;
}

export interface Warnings {
  /** Revisions whose YAML was invalid while comparing history (W2). */
  invalidRevisions: Set<string>;
}

/** Compares a concept at a commit with its parent's version, noting unparseable revisions. */
export async function changedAt(git: Git, r: HistoryRecord, warnings: Warnings): Promise<boolean> {
  const after = await git.show(r.sha, r.path);
  const before = await git.show(`${r.sha}^`, r.oldPath ?? r.path);
  const short = r.sha.slice(0, 7);
  if (after !== null && contentKey(after) === null) warnings.invalidRevisions.add(`${r.path}@${short}`);
  if (before !== null && contentKey(before) === null) warnings.invalidRevisions.add(`${r.oldPath ?? r.path}@${short}^`);
  return !sameContent(before, after);
}

/** The newest commit at which the concept's content changed (spec §5.1). */
export async function contentCommit(git: Git, path: string, warnings: Warnings): Promise<ContentCommit | null> {
  for (const r of await git.followHistory(path)) {
    if (r.status === "D") return null; // an older concept that was deleted; not ours
    if (r.status === "A" || (await changedAt(git, r, warnings))) return { sha: r.sha, authorIso: r.authorIso };
  }
  return null;
}

export type Attribution = { by: string } | { unresolvable: true } | { skipped: true };

/** Decides `generated.by` for a commit (spec §5.3). A null resolver means offline. */
export async function attribute(git: Git, sha: string, resolve: Resolver | null): Promise<Attribution> {
  const agent = (await git.coAuthors(sha)).find((c) => /@anthropic\.com$/i.test(c.email));
  if (agent) {
    const slug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return { by: `claude-code/${slug}` };
  }
  if (!resolve) return { skipped: true };
  const author = await resolve(sha);
  if (!author) return { unresolvable: true };
  return { by: `${author.type === "Bot" ? "process" : "human"}:${author.login}` };
}

export function renderGenerated(e: { by: string; at: string }): string {
  return `generated: { by: ${e.by}, at: ${e.at} }`;
}

export function expectedAt(c: ContentCommit): string {
  return toUtc(c.authorIso);
}

/** Replaces only the `generated` key. Returns the text unchanged if it is already correct. */
export function rewriteGenerated(text: string, e: { by: string; at: string }): string {
  const parsed = parseConcept(text);
  if (parsed.ok) {
    const g = parsed.frontmatter.generated as Record<string, unknown> | undefined;
    if (g && typeof g === "object" && g.by === e.by && g.at === e.at && Object.keys(g).length === 2) return text;
  }
  return setKey(text, "generated", renderGenerated(e));
}

const ACTOR = /^(?:(?:human|process):\S+|[^\s/:]+\/\S+)$/;
const ISO_UTC_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** E6: what is wrong with a `generated` value, or null if it is well formed. */
export function malformedGenerated(g: unknown): string | null {
  if (!g || typeof g !== "object" || Array.isArray(g)) return "generated is not a mapping";
  const { by, at } = g as Record<string, unknown>;
  if (typeof by !== "string" || typeof at !== "string") return "generated needs both `by` and `at`";
  if (!ACTOR.test(by)) return `generated.by "${by}" is not an actor string`;
  if (!ISO_UTC_OFFSET.test(at)) return `generated.at "${at}" is not an ISO 8601 datetime with an explicit offset`;
  return null;
}
