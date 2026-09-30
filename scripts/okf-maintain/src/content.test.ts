import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentKey, sameContent, setKey, splitFrontmatter } from "./content.js";

const doc = (fm: string, body = "Body\n") => `---\n${fm}\n---\n\n${body}`;

describe("content equality (spec §5.1)", () => {
  it("ignores key order, quoting and whitespace in frontmatter", () => {
    assert.ok(sameContent(doc("type: A\ntitle: T"), doc('title:   "T"\ntype: A')));
  });
  it("ignores generated and verified", () => {
    const base = doc("type: A");
    assert.ok(sameContent(base, doc("type: A\ngenerated: { by: x/y, at: 2026-01-01T00:00:00Z }")));
    assert.ok(sameContent(base, doc("type: A\nverified:\n  - by: human:a\n    at: 2026-01-01T00:00:00Z")));
  });
  it("counts body edits but not trailing whitespace or blank lines", () => {
    assert.ok(!sameContent(doc("type: A", "One\n"), doc("type: A", "Two\n")));
    assert.ok(sameContent(doc("type: A", "One  \r\nTwo\n"), doc("type: A", "\n\nOne\nTwo\n\n\n")));
  });
  it("counts other frontmatter changes", () => {
    assert.ok(!sameContent(doc("type: A\ntags: [a]"), doc("type: A\ntags: [b]")));
  });
  it("never treats unparseable content as equal", () => {
    assert.equal(contentKey("no frontmatter"), null);
    assert.ok(!sameContent("---\n: [\n---\n", "---\n: [\n---\n"));
    assert.ok(!sameContent(null, null));
  });
});

describe("splitFrontmatter", () => {
  it("handles empty frontmatter and keeps a later rule in the body", () => {
    assert.equal(splitFrontmatter("---\n---\nB\n").frontmatter, "");
    const s = splitFrontmatter("---\ntype: T\n---\nabove\n\n---\n\nbelow\n");
    assert.equal(s.frontmatter, "type: T");
    assert.match(s.body, /below/);
  });
  it("is null without a frontmatter block", () => {
    assert.equal(splitFrontmatter("# Title\n").frontmatter, null);
  });
});

describe("setKey", () => {
  const line = "generated: { by: a/b, at: 2026-01-01T00:00:00Z }";
  it("replaces in place and leaves every other byte alone", () => {
    const before = `---\ntype: A\ndescription: >-\n  folded\n  text\ngenerated: { by: x/y, at: 2020-01-01T00:00:00Z }\nstatus: stable\nnot:\n  - term: "q"\n---\n\nBody  \n`;
    const after = setKey(before, "generated", line);
    assert.equal(after, before.replace(/generated: .*\n/, line + "\n"));
  });
  it("replaces a block-style value", () => {
    const after = setKey("---\ntype: A\ngenerated:\n  by: x/y\n  at: 2020\nstatus: stable\n---\nB\n", "generated", line);
    assert.equal(after, `---\ntype: A\n${line}\nstatus: stable\n---\nB\n`);
  });
  it("appends at the end of the frontmatter when absent", () => {
    assert.equal(setKey("---\ntype: A\n---\n\nB\n", "generated", line), `---\ntype: A\n${line}\n---\n\nB\n`);
  });
  it("works on empty frontmatter and on text without any", () => {
    assert.equal(setKey("---\n---\nB\n", "k", "k: v"), "---\nk: v\n---\nB\n");
    assert.equal(setKey("# Hi\n", "k", "k: v"), "---\nk: v\n---\n\n# Hi\n");
    assert.equal(setKey("", "k", "k: v"), "---\nk: v\n---\n");
  });
});
