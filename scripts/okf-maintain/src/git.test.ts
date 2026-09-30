import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { changedAt, contentCommit, Warnings } from "./generated.js";
import { toUtc } from "./git.js";
import { CLAUDE, concept, TestRepo } from "./testrepo.js";

const repos: TestRepo[] = [];
const fresh = () => (repos.push(new TestRepo()), repos[repos.length - 1]);
after(() => repos.forEach((r) => r.cleanup()));
const warn = (): Warnings => ({ invalidRevisions: new Set() });

describe("content commit (spec §5.1, §15.1)", () => {
  it("is the first commit for a file never edited", async () => {
    const r = fresh();
    r.write("b/a.md", concept({ type: "T" }));
    const sha = r.commit("add");
    assert.equal((await contentCommit(r.git, "b/a.md", warn()))?.sha, sha);
  });

  it("counts a body edit but skips verified-only, generated-only and whitespace/key-order changes", async () => {
    const r = fresh();
    r.write("b/a.md", concept({ type: "T", title: "A" }, "One\n"));
    r.commit("add");
    r.write("b/a.md", concept({ type: "T", title: "A" }, "Two\n"));
    const edit = r.commit("edit body");
    r.write("b/a.md", concept({ type: "T", title: "A", verified: "[{ by: human:x, at: 2026-01-01T00:00:00Z }]" }, "Two\n"));
    r.commit("verify");
    r.write("b/a.md", concept({ type: "T", title: "A", generated: "{ by: a/b, at: 2026-01-01T00:00:00Z }" }, "Two\n"));
    r.commit("bot");
    r.write("b/a.md", "---\ntitle:   A\ntype: T\n---\n\nTwo  \n");
    r.commit("whitespace");
    assert.equal((await contentCommit(r.git, "b/a.md", warn()))?.sha, edit);
  });

  it("follows a rename and skips a pure move", async () => {
    const r = fresh();
    r.write("b/a.md", concept({ type: "T" }, "Some longer body text so rename detection is sure.\n".repeat(5)));
    const created = r.commit("add");
    r.move("b/a.md", "c/a.md");
    r.commit("move");
    assert.equal((await contentCommit(r.git, "c/a.md", warn()))?.sha, created);
  });

  it("counts an edit made during a rename", async () => {
    const r = fresh();
    const body = "Some longer body text so rename detection is sure.\n".repeat(10);
    r.write("b/a.md", concept({ type: "T" }, body));
    r.commit("add");
    r.remove("b/a.md");
    r.write("c/a.md", concept({ type: "T" }, body + "One more line.\n"));
    const sha = r.commit("move and edit");
    assert.equal((await contentCommit(r.git, "c/a.md", warn()))?.sha, sha);
  });

  it("ignores merge commits and chooses by history order, not date", async () => {
    const r = fresh();
    r.write("b/a.md", concept({ type: "T" }, "One\n"));
    r.commit("add", { at: "2026-03-01T00:00:00+00:00" });
    r.sh("checkout", "-q", "-b", "feature");
    r.write("b/other.md", concept({ type: "T" }));
    r.commit("other", { at: "2026-03-02T00:00:00+00:00" });
    r.sh("checkout", "-q", "main");
    r.write("b/a.md", concept({ type: "T" }, "Two\n"));
    // Authored *earlier* than the initial commit (clock skew): history order still wins.
    const edit = r.commit("edit", { at: "2026-02-01T00:00:00+00:00" });
    r.sh("merge", "--no-ff", "-q", "-m", "merge", "feature");
    assert.equal((await contentCommit(r.git, "b/a.md", warn()))?.sha, edit);
  });

  it("treats an unparseable revision as different and warns", async () => {
    const r = fresh();
    r.write("b/a.md", concept({ type: "T" }));
    r.commit("add");
    r.write("b/a.md", "---\ntype: [\n---\nx\n");
    r.commit("break");
    r.write("b/a.md", concept({ type: "T" }));
    const fix = r.commit("fix");
    const w = warn();
    assert.equal((await contentCommit(r.git, "b/a.md", w))?.sha, fix);
    assert.ok(w.invalidRevisions.size > 0);
  });

  it("changedAt compares against the parent", async () => {
    const r = fresh();
    r.write("b/a.md", concept({ type: "T" }, "One\n"));
    r.commit("add");
    r.write("b/a.md", concept({ type: "T" }, "Two\n"));
    const sha = r.commit("edit");
    assert.ok(await changedAt(r.git, { sha, authorIso: "", status: "M", path: "b/a.md" }, warn()));
  });
});

describe("git helpers", () => {
  it("parses Co-Authored-By trailers", async () => {
    const r = fresh();
    r.write("a.txt", "x");
    const sha = r.commit("msg", { trailers: [CLAUDE, "Co-authored-by: Someone Else <else@example.com>"] });
    assert.deepEqual(await r.git.coAuthors(sha), [
      { name: "Claude Sonnet 5.5", email: "noreply@anthropic.com" },
      { name: "Someone Else", email: "else@example.com" },
    ]);
  });

  it("detects a shallow clone", async () => {
    const r = fresh();
    r.write("a.txt", "x");
    r.commit("one");
    r.write("a.txt", "y");
    r.commit("two");
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dest = mkdtempSync(`${tmpdir()}/okf-shallow-`) + "/clone";
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${r.dir}`, dest]);
    const { Git } = await import("./git.js");
    await assert.rejects(new Git(dest).assertFullHistory(), /shallow/);
  });

  it("converts author dates to UTC", () => {
    assert.equal(toUtc("2026-09-29T11:41:53+01:00"), "2026-09-29T10:41:53Z");
    assert.equal(toUtc("2026-09-29T23:30:00-05:00"), "2026-09-30T04:30:00Z");
  });
});
