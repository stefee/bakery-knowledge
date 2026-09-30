import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { attribute, contentCommit, expectedAt, malformedGenerated, Resolver, rewriteGenerated } from "./generated.js";
import { CLAUDE, concept, TestRepo } from "./testrepo.js";

const repos: TestRepo[] = [];
const fresh = () => (repos.push(new TestRepo()), repos[repos.length - 1]);
after(() => repos.forEach((r) => r.cleanup()));
const never: Resolver = async () => {
  throw new Error("resolver should not be called");
};

function commitWith(trailers: string[], author = "Test") {
  const r = fresh();
  r.write("a.md", concept({ type: "T" }));
  return { r, sha: r.commit("add", { trailers, name: author }) };
}

describe("generated.by (spec §5.3)", () => {
  it("an Anthropic trailer wins over a human author, and is slugged", async () => {
    const { r, sha } = commitWith([CLAUDE], "Stef");
    assert.deepEqual(await attribute(r.git, sha, never), { by: "claude-code/claude-sonnet-5-5" });
  });
  it("uses the first Anthropic trailer and ignores other domains", async () => {
    const { r, sha } = commitWith(["Co-Authored-By: Bot <bot@example.com>", "Co-Authored-By: Claude Opus 4.1 <noreply@anthropic.com>", CLAUDE]);
    assert.deepEqual(await attribute(r.git, sha, never), { by: "claude-code/claude-opus-4-1" });
  });
  it("does not match a lookalike domain", async () => {
    const { r, sha } = commitWith(["Co-Authored-By: Claude <noreply@notanthropic.com>", "Co-Authored-By: X <x@anthropic.com.evil.io>"]);
    assert.deepEqual(await attribute(r.git, sha, async () => ({ login: "stefee", type: "User" })), { by: "human:stefee" });
  });
  it("resolves a human login from the API", async () => {
    const { r, sha } = commitWith([]);
    const seen: string[] = [];
    const who = await attribute(r.git, sha, async (s) => (seen.push(s), { login: "stefee", type: "User" }));
    assert.deepEqual(who, { by: "human:stefee" });
    assert.deepEqual(seen, [sha]);
  });
  it("maps a Bot account to process:", async () => {
    const { r, sha } = commitWith([]);
    assert.deepEqual(await attribute(r.git, sha, async () => ({ login: "dependabot[bot]", type: "Bot" })), { by: "process:dependabot[bot]" });
  });
  it("reports an unlinked email as unresolvable", async () => {
    const { r, sha } = commitWith([]);
    assert.deepEqual(await attribute(r.git, sha, async () => null), { unresolvable: true });
  });
  it("offline skips human commits but still resolves agents", async () => {
    const human = commitWith([]);
    assert.deepEqual(await attribute(human.r.git, human.sha, null), { skipped: true });
    const agent = commitWith([CLAUDE]);
    assert.deepEqual(await attribute(agent.r.git, agent.sha, null), { by: "claude-code/claude-sonnet-5-5" });
  });
});

describe("generated.at (spec §5.2)", () => {
  it("is the author date in UTC, not the committer date", async () => {
    const r = fresh();
    r.write("a.md", concept({ type: "T" }));
    r.commit("add", { at: "2026-09-29T11:41:53+01:00", committerAt: "2026-10-05T09:00:00+00:00" });
    const c = await contentCommit(r.git, "a.md", { invalidRevisions: new Set() });
    assert.equal(expectedAt(c!), "2026-09-29T10:41:53Z");
  });
});

describe("rewriteGenerated (spec §5.4)", () => {
  const e = { by: "claude-code/x-1", at: "2026-01-02T03:04:05Z" };
  const line = "generated: { by: claude-code/x-1, at: 2026-01-02T03:04:05Z }";

  it("replaces only the key, in place", () => {
    const before = `---\ntype: T\ntags: [a,  b]\ngenerated: { by: human:old, at: 2020-01-01T00:00:00Z }\nstatus: stable\n---\n\nBody\n`;
    assert.equal(rewriteGenerated(before, e), before.replace(/generated: .*/, line));
  });
  it("appends when absent", () => {
    assert.equal(rewriteGenerated("---\ntype: T\n---\n\nB\n", e), `---\ntype: T\n${line}\n---\n\nB\n`);
  });
  it("returns identical text when already correct, however it is formatted", () => {
    const formatted = `---\ntype: T\ngenerated:\n  by: claude-code/x-1\n  at: 2026-01-02T03:04:05Z\n---\n\nB\n`;
    assert.equal(rewriteGenerated(formatted, e), formatted);
  });
});

describe("malformedGenerated (E6)", () => {
  it("accepts well-formed values", () => {
    assert.equal(malformedGenerated({ by: "human:stefee", at: "2026-01-01T00:00:00Z" }), null);
    assert.equal(malformedGenerated({ by: "claude-code/claude-sonnet-5-5", at: "2026-01-01T00:00:00+01:00" }), null);
    assert.equal(malformedGenerated({ by: "process:ci", at: "2026-01-01T00:00Z" }), null);
  });
  it("rejects malformed values", () => {
    assert.ok(malformedGenerated("x"));
    assert.ok(malformedGenerated({ by: "human:a" }));
    assert.ok(malformedGenerated({ by: "stefee", at: "2026-01-01T00:00:00Z" }));
    assert.ok(malformedGenerated({ by: "human:a", at: "2026-01-01" }));
    assert.ok(malformedGenerated({ by: "human:a", at: "2026-01-01T00:00:00" }));
  });
});
