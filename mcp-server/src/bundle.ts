import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export interface Concept {
  /** Path within the bundle without the `.md` suffix (OKF §2). */
  id: string;
  frontmatter: Record<string, unknown>;
  body: string;
  /** Concept IDs this concept links to (OKF §6.1). Unresolved targets are kept. */
  links: string[];
}

const RESERVED = new Set(["index.md", "log.md"]);
// The frontmatter block may be empty (`---\n---`), hence the optional middle group.
const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?([\s\S]*)$/;
// [text](target.md), [text](target.md#anchor), [text](target.md "title"). Group 1 is the target.
const MD_LINK = /\[[^\]]*\]\(\s*([^)\s#]+\.md)(?:#[^)\s]*)?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
// Links shown as examples inside code are not relationships.
const FENCED_CODE = /^ {0,3}(```|~~~)[\s\S]*?^ {0,3}\1/gm;
const INLINE_CODE = /`[^`\n]*`/g;

/** Resolve a markdown link target to a concept ID, or null if it leaves the bundle. */
function linkToId(target: string, fromId: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    // Not valid percent-encoding: use the text as written.
  }
  const resolved = target.startsWith("/")
    ? path.posix.normalize(target.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromId), target));
  // Leaving the bundle root: exactly `..` or a `../` prefix (not a file merely named `..foo`).
  if (resolved === ".." || resolved.startsWith("../")) return null;
  return resolved.replace(/\.md$/, "");
}

export function parseConcept(id: string, raw: string): Concept {
  const match = FRONTMATTER.exec(raw);
  let frontmatter: Record<string, unknown> = {};
  let body = raw;
  if (match) {
    try {
      const parsed = parseYaml(match[1] ?? "");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        frontmatter = parsed as Record<string, unknown>;
      }
    } catch {
      // Consumers MUST tolerate what they can't parse; treat as a bare document.
    }
    body = match[2];
  }
  const links = new Set<string>();
  const prose = body.replace(FENCED_CODE, "").replace(INLINE_CODE, "");
  for (const m of prose.matchAll(MD_LINK)) {
    const target = linkToId(m[1], id);
    if (target && target !== id) links.add(target);
  }
  return { id, frontmatter, body, links: [...links].sort() };
}

/** Hidden directories (.git, ...) and dependency folders are never part of a bundle. */
const SKIPPED_DIRS = (name: string) => name.startsWith(".") || name === "node_modules";

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS(entry.name)) yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield full;
    }
  }
}

/** An in-memory view of an OKF bundle directory. Re-read on every load() so edits show up live. */
export class Bundle {
  concepts = new Map<string, Concept>();
  /** Raw text of index.md files, keyed by directory ("" for the root). */
  indexes = new Map<string, string>();

  constructor(readonly root: string) {}

  async load(): Promise<void> {
    const concepts = new Map<string, Concept>();
    const indexes = new Map<string, string>();
    for await (const file of walk(this.root)) {
      const rel = path.relative(this.root, file).split(path.sep).join("/");
      const base = path.posix.basename(rel);
      const raw = await readFile(file, "utf8");
      if (base === "index.md") {
        indexes.set(path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel), raw);
      } else if (!RESERVED.has(base)) {
        const id = rel.replace(/\.md$/, "");
        concepts.set(id, parseConcept(id, raw));
      }
    }
    this.concepts = concepts;
    this.indexes = indexes;
  }

  backlinks(id: string): string[] {
    return [...this.concepts.values()].filter((c) => c.links.includes(id)).map((c) => c.id).sort();
  }

  search(query: string, limit = 10): { concept: Concept; score: number }[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const hits: { concept: Concept; score: number }[] = [];
    for (const concept of this.concepts.values()) {
      const fm = concept.frontmatter;
      const title = String(fm.title ?? "").toLowerCase();
      const meta = `${fm.description ?? ""} ${JSON.stringify(fm.tags ?? [])}`.toLowerCase();
      const body = concept.body.toLowerCase();
      const id = concept.id.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t) || id.includes(t)) score += 5;
        if (meta.includes(t)) score += 3;
        if (body.includes(t)) score += 1;
      }
      if (score > 0) hits.push({ concept, score });
    }
    return hits.sort((a, b) => b.score - a.score || a.concept.id.localeCompare(b.concept.id)).slice(0, limit);
  }
}
