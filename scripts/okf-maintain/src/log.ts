import { Git, HistoryRecord } from "./git.js";
import { Frontmatter, getString, parseConcept } from "./content.js";
import { changedAt, Warnings } from "./generated.js";

type Kind = "Creation" | "Update" | "Deprecation" | "Removal";
/** Order within a day. */
const DISPLAY_ORDER: Kind[] = ["Creation", "Update", "Deprecation", "Removal"];
/** Which event wins when a concept has several in one day. */
const PRECEDENCE: Kind[] = ["Creation", "Removal", "Deprecation", "Update"];

export interface LiveConcept {
  /** Repo-relative path at HEAD (working tree). */
  repoPath: string;
  /** Bundle-relative POSIX path. */
  bundlePath: string;
  title: string;
}

interface Event {
  kind: Kind;
  day: string;
  identity: string;
  sha: string;
  /** Path at that commit (old path for a removal). */
  pathThen: string;
  /** Revision holding the version whose title to show if the concept is gone. */
  titleRev: string;
}

const isConcept = (p: string, bundle: string) =>
  p.startsWith(`${bundle}/`) && p.endsWith(".md") && !/(^|\/)(index|log)\.md$/.test(p);

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

function titleFrom(text: string | null, p: string): string {
  const parsed = text === null ? null : parseConcept(text);
  const fallback = p.split("/").pop()!.replace(/\.md$/, "");
  return (parsed?.ok && getString(parsed.frontmatter, "title")) || fallback;
}

const statusOf = (text: string | null): unknown => {
  const parsed = text === null ? null : parseConcept(text);
  return parsed?.ok ? (parsed.frontmatter as Frontmatter).status : undefined;
};

/** Expected `log.md` text (spec §7). `bundle` is the repo-relative bundle directory. */
export async function renderLog(git: Git, bundle: string, live: LiveConcept[], warnings: Warnings): Promise<string> {
  const liveByRepoPath = new Map(live.map((c) => [c.repoPath, c]));
  const records = await git.bundleHistory(bundle);

  // Walk newest to oldest, tracking where each historical path lives at HEAD.
  const map = new Map<string, string>();
  const resolve = (p: string) => map.get(p) ?? p;
  let removed = 0;
  const events: Event[] = [];
  const add = (kind: Kind, r: HistoryRecord, identity: string, pathThen: string, titleRev = r.sha) =>
    events.push({ kind, day: day(r.authorIso), identity, sha: r.sha, pathThen, titleRev });

  const removal = (r: HistoryRecord, p: string) => {
    const identity = `removed:${removed++}:${p}`;
    map.set(p, identity);
    add("Removal", r, identity, p, `${r.sha}^`);
  };

  for (const r of records) {
    if (r.status === "R") {
      const from = isConcept(r.oldPath!, bundle);
      const to = isConcept(r.path, bundle);
      if (!from && !to) continue;
      if (from && !to) {
        removal(r, r.oldPath!);
        continue;
      }
      const identity = resolve(r.path);
      if (from) map.set(r.oldPath!, identity);
      else {
        add("Creation", r, identity, r.path);
        continue;
      }
      if (await changedAt(git, r, warnings)) add(await kindOfChange(git, r), r, identity, r.path);
      continue;
    }
    if (!isConcept(r.path, bundle)) continue;
    if (r.status === "A") add("Creation", r, resolve(r.path), r.path);
    else if (r.status === "D") removal(r, r.path);
    else if (r.status === "M" && (await changedAt(git, r, warnings))) add(await kindOfChange(git, r), r, resolve(r.path), r.path);
  }

  // One bullet per concept per day, chosen by precedence.
  const chosen = new Map<string, Event>();
  for (const e of events) {
    const key = `${e.day}\0${e.identity}`;
    const prev = chosen.get(key);
    if (!prev || PRECEDENCE.indexOf(e.kind) < PRECEDENCE.indexOf(prev.kind)) chosen.set(key, e);
  }

  const days = new Map<string, { init: boolean; bullets: { kind: Kind; sortPath: string; text: string }[] }>();
  const dayEntry = (d: string) => days.get(d) ?? (days.set(d, { init: false, bullets: [] }), days.get(d)!);

  const first = await git.firstAddition(bundle);
  if (first) dayEntry(day(first)).init = true;

  for (const e of chosen.values()) {
    const liveConcept = liveByRepoPath.get(e.identity);
    let text: string;
    let sortPath: string;
    if (liveConcept) {
      text = `[${liveConcept.title}](/${liveConcept.bundlePath})`;
      sortPath = liveConcept.bundlePath;
    } else {
      const title = titleFrom(await git.show(e.titleRev, e.pathThen), e.pathThen);
      text = `${title} (\`${e.pathThen.slice(bundle.length + 1)}\`)`;
      sortPath = e.pathThen.slice(bundle.length + 1);
    }
    dayEntry(e.day).bullets.push({ kind: e.kind, sortPath, text: `* **${e.kind}**: ${text}` });
  }

  const sections = [...days.keys()].sort().reverse().map((d) => {
    const entry = days.get(d)!;
    const lines = entry.init ? ["* **Initialization**: Created the bundle."] : [];
    entry.bullets.sort((a, b) => DISPLAY_ORDER.indexOf(a.kind) - DISPLAY_ORDER.indexOf(b.kind) || (a.sortPath < b.sortPath ? -1 : a.sortPath > b.sortPath ? 1 : 0));
    return [`## ${d}`, ...lines, ...entry.bullets.map((b) => b.text)].join("\n");
  });
  return ["# Directory Update Log", ...sections].join("\n\n") + "\n";
}

async function kindOfChange(git: Git, r: HistoryRecord): Promise<Kind> {
  const after = statusOf(await git.show(r.sha, r.path));
  const before = statusOf(await git.show(`${r.sha}^`, r.oldPath ?? r.path));
  return after === "deprecated" && before !== "deprecated" ? "Deprecation" : "Update";
}
