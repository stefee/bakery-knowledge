import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Git } from "./git.js";

export interface CommitOptions {
  /** Author date (ISO, any offset). */
  at?: string;
  /** Committer date; defaults to `at`. */
  committerAt?: string;
  name?: string;
  email?: string;
  /** Extra message lines, e.g. `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. */
  trailers?: string[];
}

export const CLAUDE = "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>";

/** A throwaway git repository with controllable author dates and trailers. */
export class TestRepo {
  readonly dir = mkdtempSync(path.join(tmpdir(), "okf-maintain-"));
  readonly git = new Git(this.dir);
  private counter = 0;

  constructor() {
    this.sh("init", "-q", "-b", "main");
    this.sh("config", "user.name", "Test");
    this.sh("config", "user.email", "test@example.com");
    this.sh("config", "commit.gpgsign", "false");
  }

  sh(...args: string[]): string {
    return execFileSync("git", args, { cwd: this.dir, encoding: "utf8", env: { ...process.env, ...this.env } });
  }

  private env: Record<string, string> = {};

  write(file: string, content: string): void {
    mkdirSync(path.dirname(path.join(this.dir, file)), { recursive: true });
    writeFileSync(path.join(this.dir, file), content);
  }

  read(file: string): string {
    return readFileSync(path.join(this.dir, file), "utf8");
  }

  move(from: string, to: string): void {
    mkdirSync(path.dirname(path.join(this.dir, to)), { recursive: true });
    renameSync(path.join(this.dir, from), path.join(this.dir, to));
  }

  remove(file: string): void {
    rmSync(path.join(this.dir, file), { force: true });
  }

  /** Stages everything and commits; returns the commit sha. */
  commit(message: string, o: CommitOptions = {}): string {
    this.counter++;
    const at = o.at ?? `2026-01-01T00:00:${String(this.counter).padStart(2, "0")}+00:00`;
    this.env = {
      GIT_AUTHOR_NAME: o.name ?? "Test",
      GIT_AUTHOR_EMAIL: o.email ?? "test@example.com",
      GIT_AUTHOR_DATE: at,
      GIT_COMMITTER_DATE: o.committerAt ?? at,
    };
    this.sh("add", "-A");
    const body = [message, ...(o.trailers?.length ? ["", ...o.trailers] : [])].join("\n");
    this.sh("commit", "-q", "--allow-empty", "-m", body);
    this.env = {};
    return this.sh("rev-parse", "HEAD").trim();
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export function concept(fm: Record<string, string>, body = "Body.\n"): string {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

import { main } from "./cli.js";
import { Resolver } from "./generated.js";

export interface RunResult {
  code: number;
  out: string;
}

const dummyEnv = { GITHUB_TOKEN: "x", GITHUB_REPOSITORY: "o/r" };

/** Runs the CLI against `<repo>/<bundle>` with a stub resolver instead of the GitHub API. */
export async function run(
  r: TestRepo,
  command: "sync" | "check",
  o: { bundle?: string; resolver?: Resolver; args?: string[]; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  const lines: string[] = [];
  const resolver: Resolver = o.resolver ?? (async () => ({ login: "stefee", type: "User" }));
  const code = await main(
    [command, "--bundle", path.join(r.dir, o.bundle ?? "kb"), ...(o.args ?? [])],
    { ...dummyEnv, ...o.env },
    resolver,
    (s) => lines.push(s),
  );
  return { code, out: lines.join("\n") };
}
