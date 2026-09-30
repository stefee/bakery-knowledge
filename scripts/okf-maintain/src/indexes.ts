import path from "node:path/posix";

export interface ConceptInfo {
  /** Bundle-relative POSIX path, e.g. `bakehouse/ember-index.md`. */
  path: string;
  type: string;
  title: string;
  description?: string;
}

const lower = (s: string) => s.toLowerCase();
const cmp = (a: string, b: string) => (lower(a) < lower(b) ? -1 : lower(a) > lower(b) ? 1 : a < b ? -1 : a > b ? 1 : 0);

/** Directories (bundle-relative, root is "") that hold concepts directly or through a subdirectory. */
export function directoriesWithContent(concepts: ConceptInfo[]): Set<string> {
  const dirs = new Set<string>();
  for (const c of concepts) {
    let d = path.dirname(c.path);
    while (d !== ".") {
      dirs.add(d);
      d = path.dirname(d);
    }
  }
  return dirs;
}

/** Expected folder index.md text for every directory below the root (spec §6.1), keyed by directory. */
export function renderFolderIndexes(concepts: ConceptInfo[]): Map<string, string> {
  const dirs = directoriesWithContent(concepts);
  const out = new Map<string, string>();
  for (const dir of dirs) {
    const here = concepts.filter((c) => path.dirname(c.path) === dir);
    const types = [...new Set(here.map((c) => c.type))].sort(cmp);
    const sections: string[] = [];
    for (const type of types) {
      const entries = here
        .filter((c) => c.type === type)
        .sort((a, b) => cmp(a.title, b.title) || cmp(a.path, b.path))
        .map((c) => `* [${c.title}](${path.basename(c.path)})${c.description ? ` - ${c.description.replace(/\s+/g, " ").trim()}` : ""}`);
      sections.push(`# ${type}\n\n${entries.join("\n")}`);
    }
    const subdirs = [...dirs].filter((d) => path.dirname(d) === dir).map((d) => path.basename(d)).sort(cmp);
    if (subdirs.length) sections.push(`# Subdirectories\n\n${subdirs.map((s) => `* [${s}](${s}/index.md)`).join("\n")}`);
    out.set(dir, sections.join("\n\n") + "\n");
  }
  return out;
}
