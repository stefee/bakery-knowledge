import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { after, describe, it } from "node:test";
import { CLAUDE, concept, run, TestRepo } from "./testrepo.js";

const repos: TestRepo[] = [];
after(() => repos.forEach((r) => r.cleanup()));
const AT = { at: "2026-02-01T12:00:00+00:00", trailers: [CLAUDE] };

const ROOT = `---\nokf_version: "0.2"\n---\n\n# Subdirectories\n\n* [dir](dir/index.md) - things\n`;

/** A bundle that has been synced and committed, so `check` passes. */
async function synced(): Promise<TestRepo> {
  const r = new TestRepo();
  repos.push(r);
  r.write("kb/index.md", ROOT);
  r.write("kb/dir/a.md", concept({ type: "Metric", title: "A", description: "First." }, "See [b](/dir/b.md).\n"));
  r.write("kb/dir/b.md", concept({ type: "Metric", title: "B" }));
  r.commit("add", AT);
  await settle(r);
  return r;
}

async function settle(r: TestRepo) {
  await run(r, "sync");
  r.commit("Sync OKF metadata", { name: "github-actions[bot]" });
}

async function assertFails(r: TestRepo, id: string, args: string[] = []) {
  const res = await run(r, "check", { args });
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, new RegExp(`^${id} error`, "m"), res.out);
}

describe("check passes after sync (spec §1 goal 4)", () => {
  it("passes on a synced bundle, and sync is idempotent", async () => {
    const r = await synced();
    const res = await run(r, "check");
    assert.equal(res.code, 0, res.out);
    const again = await run(r, "sync");
    assert.match(again.out, /wrote 0 file/);
    assert.equal(r.sh("status", "--porcelain"), "");
  });

  it("sync fixes drift and then check passes", async () => {
    const r = await synced();
    r.write("kb/dir/index.md", "hand edit\n");
    r.write("kb/log.md", "# Directory Update Log\n");
    r.commit("drift", { name: "x" });
    assert.equal((await run(r, "check")).code, 1);
    await run(r, "sync");
    assert.equal((await run(r, "check")).code, 0);
  });
});

describe("check rules (spec §8)", () => {
  it("E1 no frontmatter / invalid YAML", async () => {
    const r = await synced();
    r.write("kb/dir/c.md", "no frontmatter\n");
    r.write("kb/dir/d.md", "---\ntype: [\n---\n");
    r.commit("bad", AT);
    const res = await run(r, "check");
    assert.match(res.out, /^E1 error kb\/dir\/c\.md/m);
    assert.match(res.out, /^E1 error kb\/dir\/d\.md/m);
  });
  it("E2 missing type", async () => {
    const r = await synced();
    r.write("kb/dir/c.md", concept({ title: "C" }));
    r.commit("notype", AT);
    await assertFails(r, "E2");
  });
  it("E3 folder index with frontmatter", async () => {
    const r = await synced();
    r.write("kb/dir/index.md", "---\nx: 1\n---\n" + r.read("kb/dir/index.md"));
    r.commit("fm", AT);
    await assertFails(r, "E3");
  });
  it("E4 log format", async () => {
    const r = await synced();
    r.write("kb/log.md", "# Directory Update Log\n\n## 2026-01-01\n* x\n\n## 2026-02-01\n* y\n\n## yesterday\n");
    r.commit("log", AT);
    const res = await run(r, "check");
    assert.match(res.out, /^E4 error.*not older/m);
    assert.match(res.out, /^E4 error.*not an ISO/m);
    r.write("kb/log.md", "no title\n");
    r.commit("log2", AT);
    assert.match((await run(r, "check")).out, /^E4 error.*title/m);
  });
  it("E5 root index extra keys", async () => {
    const r = await synced();
    r.write("kb/index.md", ROOT.replace('okf_version: "0.2"', 'okf_version: "0.2"\nextra: 1'));
    r.commit("x", AT);
    await assertFails(r, "E5");
  });
  it("E6 malformed generated", async () => {
    const r = await synced();
    r.write("kb/dir/a.md", r.read("kb/dir/a.md").replace(/generated: .*/, "generated: { by: nobody, at: soon }"));
    r.commit("x", AT);
    await assertFails(r, "E6");
  });
  it("E7 generated drift or missing", async () => {
    const r = await synced();
    r.write("kb/dir/a.md", r.read("kb/dir/a.md").replace(/at: \S+ \}/, "at: 2020-01-01T00:00:00Z }"));
    r.write("kb/dir/b.md", r.read("kb/dir/b.md").replace(/generated: .*\n/, ""));
    r.commit("x", AT);
    const res = await run(r, "check");
    assert.match(res.out, /^E7 error kb\/dir\/a\.md/m);
    assert.match(res.out, /^E7 error kb\/dir\/b\.md/m);
  });
  it("E8 index drift, missing and unexpected", async () => {
    const r = await synced();
    r.write("kb/dir/index.md", "edited\n");
    r.write("kb/empty/index.md", "# Stray\n");
    r.commit("x", AT);
    const res = await run(r, "check");
    assert.match(res.out, /^E8 error kb\/dir\/index\.md: folder index differs/m);
    assert.match(res.out, /^E8 error kb\/empty\/index\.md: unexpected/m);
    r.remove("kb/dir/index.md");
    r.commit("y", AT);
    assert.match((await run(r, "check")).out, /^E8 error kb\/dir\/index\.md: folder index is missing/m);
  });
  it("E9 log drift", async () => {
    const r = await synced();
    r.write("kb/log.md", "# Directory Update Log\n");
    r.commit("x", AT);
    await assertFails(r, "E9");
  });
  it("E10 top-level directory not linked from the root index", async () => {
    const r = await synced();
    r.write("kb/other/c.md", concept({ type: "T", title: "C" }));
    r.commit("x", AT);
    await settle(r);
    const res = await run(r, "check");
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /^E10 error.*"other"/m);
  });
  it("E11 root okf_version", async () => {
    const r = await synced();
    r.write("kb/index.md", ROOT.replace('"0.2"', '"0.1"'));
    r.commit("x", AT);
    await assertFails(r, "E11");
  });
  it("E12 unresolvable attribution; sync leaves the key alone", async () => {
    const r = new TestRepo();
    repos.push(r);
    r.write("kb/index.md", ROOT);
    r.write("kb/dir/a.md", concept({ type: "T", title: "A", generated: "{ by: human:old, at: 2020-01-01T00:00:00Z }" }));
    r.commit("add", { name: "Stranger", email: "stranger@nowhere.example" });
    const before = r.read("kb/dir/a.md");
    const res = await run(r, "check", { resolver: async () => null });
    assert.equal(res.code, 1);
    assert.match(res.out, /^E12 error kb\/dir\/a\.md/m);
    const sync = await run(r, "sync", { resolver: async () => null });
    assert.equal(sync.code, 0);
    assert.equal(r.read("kb/dir/a.md"), before);
  });
  it("W1 broken link is a warning only", async () => {
    const r = await synced();
    r.write("kb/dir/b.md", concept({ type: "Metric", title: "B" }, "See [x](/dir/missing.md), [web](https://e.com/a.md), [anchor](#top) and\n\n```\n[code](/nope.md)\n```\n"));
    r.commit("x", AT);
    await settle(r);
    const res = await run(r, "check");
    assert.equal(res.code, 0, res.out);
    assert.match(res.out, /^W1 warning kb\/dir\/b\.md.*\/dir\/missing\.md/m);
    assert.doesNotMatch(res.out, /nope|e\.com/);
  });
  it("W2 invalid historical YAML is a warning only", async () => {
    const r = await synced();
    r.write("kb/dir/b.md", "---\ntype: [\n---\n");
    r.commit("break", AT);
    r.write("kb/dir/b.md", concept({ type: "Metric", title: "B" }));
    r.commit("fix", AT);
    await settle(r);
    const res = await run(r, "check");
    assert.equal(res.code, 0, res.out);
    assert.match(res.out, /^W2 warning/m);
  });
});

describe("check modes and exit codes (spec §4)", () => {
  it("skips concepts with uncommitted content changes, with a notice", async () => {
    const r = await synced();
    r.write("kb/dir/a.md", r.read("kb/dir/a.md") + "\nlocal edit\n");
    const res = await run(r, "check");
    assert.match(res.out, /uncommitted content changes/);
    assert.equal(res.code, 0, res.out);
  });
  it("--offline skips human attribution only", async () => {
    const r = new TestRepo();
    repos.push(r);
    r.write("kb/index.md", ROOT);
    r.write("kb/dir/a.md", concept({ type: "T", title: "A" }));
    r.commit("add", { name: "Stef", at: "2026-02-01T12:00:00+00:00" });
    await run(r, "sync");
    r.commit("sync", { name: "bot" });
    const throwing = async () => {
      throw new Error("no network");
    };
    const res = await run(r, "check", { args: ["--offline"], resolver: throwing });
    assert.equal(res.code, 0, res.out);
    assert.match(res.out, /--offline: generated\.by not compared/);
    // Other checks still run.
    r.write("kb/log.md", "# Directory Update Log\n");
    r.commit("drift", { name: "x" });
    assert.equal((await run(r, "check", { args: ["--offline"], resolver: throwing })).code, 1);
  });
  it("exits 2 for usage and environment errors", async () => {
    const r = await synced();
    assert.equal((await run(r, "check", { bundle: "missing" })).code, 2);
    assert.equal((await run(r, "check", { args: ["--bogus"] })).code, 2);
    // Missing token without a stub resolver.
    const { main } = await import("./cli.js");
    const out: string[] = [];
    assert.equal(await main(["check", "--bundle", `${r.dir}/kb`], {}, undefined, (s) => out.push(s)), 2);
    assert.match(out.join("\n"), /GITHUB_TOKEN/);
    assert.equal(await main(["check"], {}, undefined, () => {}), 2);
  });
  it("rejects a shallow clone", async () => {
    const r = await synced();
    const dest = mkdtempSync(`${tmpdir()}/okf-shallow-`) + "/clone";
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${r.dir}`, dest]);
    const { main } = await import("./cli.js");
    const out: string[] = [];
    assert.equal(await main(["check", "--bundle", `${dest}/kb`], { GITHUB_TOKEN: "x", GITHUB_REPOSITORY: "o/r" }, async () => null, (s) => out.push(s)), 2);
    assert.match(out.join("\n"), /shallow/);
  });
});
