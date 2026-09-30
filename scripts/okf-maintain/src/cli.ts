import { appendFileSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { githubResolver } from "./github.js";
import { Git, UsageError } from "./git.js";
import { computePlan, Finding, Plan } from "./plan.js";
import { Resolver } from "./generated.js";

interface Args {
  command: "sync" | "check";
  bundle: string;
  offline: boolean;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args {
  const [command, ...rest] = argv;
  if (command !== "sync" && command !== "check") throw new UsageError("usage: okf-maintain <sync|check> [--bundle <path>] [--offline]");
  let bundle = env.OKF_BUNDLE_PATH ?? "";
  let offline = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--bundle") bundle = rest[++i] ?? "";
    else if (rest[i] === "--offline" && command === "check") offline = true;
    else throw new UsageError(`unknown argument: ${rest[i]}`);
  }
  if (!bundle) throw new UsageError("no bundle: pass --bundle <path> or set OKF_BUNDLE_PATH");
  if (!existsSync(bundle)) throw new UsageError(`bundle directory not found: ${bundle}`);
  // Resolve symlinks so the path agrees with `git rev-parse --show-toplevel`.
  return { command, bundle: realpathSync(bundle), offline };
}

export function format(f: Finding): string {
  return `${f.id} ${f.level}${f.path ? ` ${f.path}` : ""}: ${f.message}`;
}

/** Runs a command and returns the exit code. `resolver` overrides the GitHub lookup (for tests). */
export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, resolver?: Resolver, out: (s: string) => void = console.log): Promise<number> {
  try {
    const args = parseArgs(argv, env);
    const root = await Git.toplevel(args.bundle);
    const git = new Git(root);
    await git.assertFullHistory();

    let resolve: Resolver | null = resolver ?? null;
    if (!resolve && !args.offline) {
      if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) throw new UsageError("GITHUB_TOKEN and GITHUB_REPOSITORY are required (or pass --offline to check)");
      resolve = githubResolver(env.GITHUB_TOKEN, env.GITHUB_REPOSITORY);
    }

    const plan = await computePlan({ bundle: args.bundle, git, root, resolver: args.offline ? null : resolve });
    const code = args.command === "sync" ? sync(plan, out) : report(plan, out);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary(args.command, plan, code) + "\n");
    return code;
  } catch (err) {
    if (err instanceof UsageError) {
      out(`error: ${err.message}`);
      return 2;
    }
    throw err;
  }
}

function sync(plan: Plan, out: (s: string) => void): number {
  for (const [file, text] of plan.writes) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  for (const file of plan.deletes) rmSync(file);
  // Drift findings (E7 to E9, E11) were just fixed by the writes above; show the rest.
  const drift = new Set(["E7", "E8", "E9", "E11"]);
  for (const f of plan.findings) if (!drift.has(f.id)) out(format(f));
  out(`sync: wrote ${plan.writes.size} file(s), deleted ${plan.deletes.size}`);
  return 0;
}

function report(plan: Plan, out: (s: string) => void): number {
  for (const f of plan.findings) out(format(f));
  const errors = plan.findings.filter((f) => f.level === "error").length;
  out(errors ? `check: ${errors} error(s)` : "check: ok");
  return errors ? 1 : 0;
}

function summary(command: string, plan: Plan, code: number): string {
  const lines = plan.findings.map((f) => `- \`${f.id}\` ${f.level}${f.path ? ` \`${f.path}\`` : ""}: ${f.message}`);
  return [`### okf-maintain ${command}: ${code === 0 ? "ok" : "failed"}`, ...(lines.length ? lines : ["No findings."])].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(2);
  });
}
