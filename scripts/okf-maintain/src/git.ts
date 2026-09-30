import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export class UsageError extends Error {}

export interface HistoryRecord {
  sha: string;
  /** Author date as strict ISO 8601 with the author's offset. */
  authorIso: string;
  /** `A`, `M`, `D` or `R` (similarity stripped). */
  status: string;
  path: string;
  /** Only for renames: the path before the rename (`path` is the new one). */
  oldPath?: string;
}

export class Git {
  constructor(readonly cwd: string) {}

  async run(args: string[]): Promise<string> {
    const { stdout } = await exec("git", args, { cwd: this.cwd, maxBuffer: 256 * 1024 * 1024 });
    return stdout;
  }

  /** Top-level directory of the repository containing `dir`. */
  static async toplevel(dir: string): Promise<string> {
    try {
      const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: dir });
      return stdout.trim();
    } catch {
      throw new UsageError(`${dir} is not inside a git repository`);
    }
  }

  async assertFullHistory(): Promise<void> {
    if ((await this.run(["rev-parse", "--is-shallow-repository"])).trim() !== "false") {
      throw new UsageError("shallow clone: okf-maintain needs the full git history (use fetch-depth: 0)");
    }
  }

  /** File content at a revision (`sha:path`), or null when it doesn't exist there. */
  async show(rev: string, path: string): Promise<string | null> {
    try {
      return await this.run(["show", `${rev}:${path}`]);
    } catch {
      return null;
    }
  }

  async trackedFiles(dir: string): Promise<string[]> {
    return (await this.run(["ls-files", "-z", "--", dir])).split("\0").filter(Boolean);
  }

  async untrackedFiles(dir: string): Promise<string[]> {
    return (await this.run(["ls-files", "-z", "--others", "--exclude-standard", "--", dir])).split("\0").filter(Boolean);
  }

  async hasHead(): Promise<boolean> {
    try {
      await this.run(["rev-parse", "--verify", "-q", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  /** History of one live path, newest first, following renames (spec §15.1). */
  async followHistory(path: string): Promise<HistoryRecord[]> {
    const out = await this.run([
      "log", "--follow", "--no-merges", "--topo-order", "-M", "--name-status", "--format=@%H|%aI", "--", path,
    ]);
    return parseRecords(out);
  }

  /** History of everything under `dir`, newest first (spec §15.2). */
  async bundleHistory(dir: string): Promise<HistoryRecord[]> {
    const out = await this.run([
      "log", "--no-merges", "--topo-order", "-M", "--name-status", "--format=@%H|%aI", "--", dir,
    ]);
    return parseRecords(out);
  }

  /** Author date of the first commit that added any file under `dir`. */
  async firstAddition(dir: string): Promise<string | null> {
    const out = await this.run([
      "log", "--no-merges", "--topo-order", "--reverse", "--diff-filter=A", "--format=%aI", "--", dir,
    ]);
    return out.split("\n").find((l) => l.trim() !== "") ?? null;
  }

  /** `Co-Authored-By` trailers of a commit as `{name, email}` pairs, in order. */
  async coAuthors(sha: string): Promise<{ name: string; email: string }[]> {
    const out = await this.run(["log", "-1", "--format=%(trailers:key=Co-Authored-By,valueonly)", sha]);
    const result: { name: string; email: string }[] = [];
    for (const line of out.split("\n")) {
      const m = /^(.*) <([^>]+)>$/.exec(line.trim());
      if (m) result.push({ name: m[1].trim(), email: m[2] });
    }
    return result;
  }
}

export function parseRecords(out: string): HistoryRecord[] {
  const records: HistoryRecord[] = [];
  let header: { sha: string; authorIso: string } | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("@")) {
      const [sha, authorIso] = line.slice(1).split("|");
      header = { sha, authorIso };
      continue;
    }
    if (!header || line.trim() === "") continue;
    const parts = line.split("\t");
    const status = parts[0][0];
    if (status === "R" || status === "C") {
      if (status === "R") records.push({ ...header, status: "R", oldPath: parts[1], path: parts[2] });
      else records.push({ ...header, status: "A", path: parts[2] });
    } else {
      records.push({ ...header, status, path: parts[1] });
    }
  }
  return records;
}

/** Author date (any offset) as `YYYY-MM-DDTHH:MM:SSZ`. */
export function toUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}
