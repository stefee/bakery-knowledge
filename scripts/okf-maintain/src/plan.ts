import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import posix from "node:path/posix";
import { getString, Frontmatter, parseConcept, sameContent, setKey, splitFrontmatter } from "./content.js";
import { attribute, contentCommit, expectedAt, malformedGenerated, Resolver, rewriteGenerated, Warnings } from "./generated.js";
import { Git } from "./git.js";
import { ConceptInfo, directoriesWithContent, renderFolderIndexes } from "./indexes.js";
import { LiveConcept, renderLog } from "./log.js";

export const OKF_VERSION = "0.2";

export type Level = "error" | "warning" | "notice";

export interface Finding {
  id: string;
  level: Level;
  path?: string;
  message: string;
}

export interface Plan {
  /** Files whose content `sync` would change, by absolute path. */
  writes: Map<string, string>;
  /** Files `sync` would delete, by absolute path. */
  deletes: Set<string>;
  findings: Finding[];
}

export interface Options {
  /** Absolute path of the bundle directory. */
  bundle: string;
  git: Git;
  /** Absolute path of the repository top level. */
  root: string;
  /** Null means offline: human logins are not resolved. */
  resolver: Resolver | null;
}

const lf = (s: string) => s.replace(/\r\n?/g, "\n");
const read = (p: string) => readFileSync(p, "utf8");
const posixRel = (from: string, to: string) => path.relative(from, to).split(path.sep).join("/");

/** Works out everything `sync` would do, without touching the working tree. */
export async function computePlan(o: Options): Promise<Plan> {
  const plan: Plan = { writes: new Map(), deletes: new Set(), findings: [] };
  const find = (id: string, level: Level, message: string, p?: string) => plan.findings.push({ id, level, message, path: p });
  const bundleRel = posixRel(o.root, o.bundle);
  const abs = (bundlePath: string) => path.join(o.bundle, bundlePath);
  const warnings: Warnings = { invalidRevisions: new Set() };
  const hasHead = await o.git.hasHead();

  // --- Discovery (spec §4.1) ---
  const tracked = (await o.git.trackedFiles(bundleRel)).filter((f) => existsSync(path.join(o.root, f)));
  const conceptPaths = tracked
    .filter((f) => f.endsWith(".md") && !/(^|\/)(index|log)\.md$/.test(f))
    .map((f) => f.slice(bundleRel.length + 1))
    .sort();
  for (const f of await o.git.untrackedFiles(bundleRel)) {
    if (f.endsWith(".md")) find("NOTICE", "notice", "untracked file skipped", f);
  }

  const infos: ConceptInfo[] = [];
  const live: LiveConcept[] = [];
  const texts = new Map<string, string>();

  for (const cp of conceptPaths) {
    const text = lf(read(abs(cp)));
    texts.set(cp, text);
    const parsed = parseConcept(text);
    const repoPath = `${bundleRel}/${cp}`;
    if (!parsed.ok) {
      find("E1", "error", parsed.reason === "no frontmatter" ? "concept has no frontmatter" : `frontmatter is not valid: ${parsed.reason}`, repoPath);
      continue;
    }
    const fm = parsed.frontmatter;
    const type = getString(fm, "type");
    if (!type) find("E2", "error", "`type` is missing or empty", repoPath);
    const title = getString(fm, "title") ?? posix.basename(cp, ".md");
    infos.push({ path: cp, type: type ?? "Unknown", title, description: getString(fm, "description") });
    live.push({ repoPath, bundlePath: cp, title });
    checkLinks(o, cp, parsed.body, conceptPaths, find, repoPath);
  }

  // --- generated (spec §5) ---
  for (const cp of conceptPaths) {
    const text = texts.get(cp)!;
    const parsed = parseConcept(text);
    if (!parsed.ok) continue;
    const repoPath = `${bundleRel}/${cp}`;
    const actual = parsed.frontmatter.generated;
    if (actual !== undefined) {
      const bad = malformedGenerated(actual);
      if (bad) find("E6", "error", bad, repoPath);
    }
    if (!hasHead) continue;
    const head = await o.git.show("HEAD", repoPath);
    if (head === null) continue; // not in history yet
    if (!sameContent(head, text)) {
      find("NOTICE", "notice", "uncommitted content changes: generated left alone", repoPath);
      continue;
    }
    const commit = await contentCommit(o.git, repoPath, warnings);
    if (!commit) continue;
    const at = expectedAt(commit);
    const who = await attribute(o.git, commit.sha, o.resolver);
    if ("unresolvable" in who) {
      find("E12", "error", `attribution unresolvable: the author of ${commit.sha.slice(0, 7)} isn't linked to a GitHub account (link the commit email, then re-run the workflow)`, repoPath);
      continue;
    }
    if ("skipped" in who) {
      find("NOTICE", "notice", "--offline: generated.by not compared", repoPath);
      const g = actual as Record<string, unknown> | undefined;
      if (!g || typeof g !== "object" || g.at !== at) find("E7", "error", `generated is missing or wrong (at should be ${at})`, repoPath);
      continue;
    }
    const next = rewriteGenerated(text, { by: who.by, at });
    if (next !== text) {
      plan.writes.set(abs(cp), next);
      find("E7", "error", `generated differs from git history (should be by: ${who.by}, at: ${at})`, repoPath);
    }
  }

  // --- Folder indexes (spec §6.1) ---
  const expectedIndexes = renderFolderIndexes(infos);
  for (const [dir, text] of expectedIndexes) {
    const file = abs(`${dir}/index.md`);
    const repoPath = `${bundleRel}/${dir}/index.md`;
    if (!existsSync(file)) find("E8", "error", "folder index is missing", repoPath);
    else if (lf(read(file)) === text) continue;
    else find("E8", "error", "folder index differs from what sync would write", repoPath);
    plan.writes.set(file, text);
  }
  for (const file of findIndexFiles(o.bundle)) {
    const dir = posixRel(o.bundle, path.dirname(file));
    if (dir === "") continue;
    const repoPath = `${bundleRel}/${dir}/index.md`;
    if (splitFrontmatter(lf(read(file))).frontmatter !== null) find("E3", "error", "folder index must not have frontmatter", repoPath);
    if (!expectedIndexes.has(dir)) {
      plan.deletes.add(file);
      find("E8", "error", "unexpected folder index (the directory has no concepts)", repoPath);
    }
  }

  // --- Root index (spec §6.2, §6.3) ---
  const rootFile = abs("index.md");
  const rootRepoPath = `${bundleRel}/index.md`;
  const rootText = existsSync(rootFile) ? lf(read(rootFile)) : "";
  const rootSplit = splitFrontmatter(rootText);
  const rootParsed = rootSplit.frontmatter === null ? null : parseConcept(rootText);
  const rootFm: Frontmatter = rootParsed?.ok ? rootParsed.frontmatter : {};
  if (rootFm.okf_version !== OKF_VERSION) {
    find("E11", "error", `root index needs okf_version: "${OKF_VERSION}"`, rootRepoPath);
    plan.writes.set(rootFile, setKey(rootText, "okf_version", `okf_version: "${OKF_VERSION}"`));
  }
  const extra = Object.keys(rootFm).filter((k) => k !== "okf_version");
  if (extra.length) find("E5", "error", `root index frontmatter has unexpected keys: ${extra.join(", ")}`, rootRepoPath);
  const links = [...rootSplit.body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1].replace(/^\.?\//, ""));
  for (const dir of [...directoriesWithContent(infos)].filter((d) => !d.includes("/")).sort()) {
    if (!links.some((l) => l === `${dir}/` || l === `${dir}/index.md`)) find("E10", "error", `top-level directory "${dir}" isn't linked from the root index`, rootRepoPath);
  }

  // --- log.md (spec §7) ---
  const logFile = abs("log.md");
  const logRepoPath = `${bundleRel}/log.md`;
  if (hasHead) {
    const expected = await renderLog(o.git, bundleRel, live, warnings);
    if (!existsSync(logFile)) {
      find("E9", "error", "log.md is missing", logRepoPath);
      plan.writes.set(logFile, expected);
    } else if (lf(read(logFile)) !== expected) {
      find("E9", "error", "log.md differs from what sync would write", logRepoPath);
      plan.writes.set(logFile, expected);
    }
  }
  if (existsSync(logFile)) checkLogFormat(lf(read(logFile)), find, logRepoPath);

  for (const w of [...warnings.invalidRevisions].sort()) find("W2", "warning", `historical revision has invalid YAML, so the content commit may be imprecise: ${w}`);
  return plan;
}

function findIndexFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findIndexFiles(p));
    else if (e.name === "index.md") out.push(p);
  }
  return out;
}

function checkLinks(o: Options, cp: string, body: string, conceptPaths: string[], find: (id: string, level: Level, message: string, p?: string) => void, repoPath: string) {
  const stripped = body.replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
  for (const m of stripped.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    let target = m[1].split("#")[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || !target.endsWith(".md")) continue;
    target = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(posix.dirname(cp), target));
    if (!conceptPaths.includes(target) && !existsSync(path.join(o.bundle, target))) find("W1", "warning", `link to ${m[1]} targets a file that doesn't exist`, repoPath);
  }
}

function checkLogFormat(text: string, find: (id: string, level: Level, message: string, p?: string) => void, repoPath: string) {
  const lines = text.split("\n");
  const first = lines.find((l) => l.trim() !== "");
  if (!first || !/^# \S/.test(first)) find("E4", "error", "log.md must start with a `# ` title", repoPath);
  let previous = "";
  for (const l of lines) {
    if (!l.startsWith("## ")) continue;
    const d = l.slice(3).trim();
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().startsWith(d);
    if (!valid) find("E4", "error", `"${l}" is not an ISO YYYY-MM-DD date heading`, repoPath);
    else if (previous && d >= previous) find("E4", "error", `date ${d} is not older than the one above it (newest first)`, repoPath);
    if (valid) previous = d;
  }
}
