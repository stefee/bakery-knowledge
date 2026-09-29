import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { Bundle, parseConcept } from "./bundle.js";

describe("parseConcept frontmatter", () => {
  it("parses ordinary frontmatter and returns the body", () => {
    const c = parseConcept("a", "---\ntype: Thing\ntitle: A\n---\n\nBody text\n");
    assert.equal(c.frontmatter.type, "Thing");
    assert.equal(c.body.trim(), "Body text");
  });

  it("handles CRLF line endings", () => {
    const c = parseConcept("a", "---\r\ntype: Thing\r\n---\r\nBody\r\n");
    assert.equal(c.frontmatter.type, "Thing");
    assert.equal(c.body.trim(), "Body");
  });

  it("treats an empty frontmatter block as frontmatter, not body", () => {
    const c = parseConcept("a", "---\n---\nBody\n");
    assert.deepEqual(c.frontmatter, {});
    assert.equal(c.body.trim(), "Body");
  });

  it("keeps a later '---' rule in the body", () => {
    const c = parseConcept("a", "---\ntype: T\n---\nabove\n\n---\n\nbelow\n");
    assert.equal(c.frontmatter.type, "T");
    assert.match(c.body, /above[\s\S]*---[\s\S]*below/);
  });

  it("tolerates unparseable frontmatter (the body is still served)", () => {
    const c = parseConcept("a", "---\ntype: [unclosed\n---\nBody\n");
    assert.deepEqual(c.frontmatter, {});
    assert.equal(c.body.trim(), "Body");
  });

  it("ignores frontmatter that is a list rather than a mapping", () => {
    assert.deepEqual(parseConcept("a", "---\n- one\n- two\n---\nBody\n").frontmatter, {});
  });

  it("treats a file with no frontmatter as all body", () => {
    const c = parseConcept("a", "# Just markdown\n");
    assert.deepEqual(c.frontmatter, {});
    assert.equal(c.body, "# Just markdown\n");
  });
});

describe("parseConcept links", () => {
  const links = (body: string, id = "dir/a") => parseConcept(id, `---\ntype: T\n---\n${body}`).links;

  it("resolves bundle-absolute and relative links", () => {
    assert.deepEqual(links("[x](/other/b.md) [y](./c.md) [z](../top.md)"), ["dir/c", "other/b", "top"]);
  });

  it("strips anchors and accepts a link title", () => {
    assert.deepEqual(links('[x](/b.md#sec) [y](/c.md "The title") [z](/d.md \'t\')'), ["b", "c", "d"]);
  });

  it("decodes percent-encoding", () => {
    assert.deepEqual(links("[x](/my%20file.md)"), ["my file"]);
  });

  it("ignores external URLs and links that leave the bundle", () => {
    assert.deepEqual(links("[x](https://example.com/a.md) [y](../../out.md)", "a"), []);
  });

  it("keeps a file whose name merely starts with two dots", () => {
    assert.deepEqual(links("[x](/..notes.md)"), ["..notes"]);
  });

  it("ignores links inside fenced code and inline code", () => {
    const body = "real [r](/real.md)\n\n```md\n[fake](/fenced.md)\n```\n\n~~~\n[fake](/tilde.md)\n~~~\n\ninline `[fake](/inline.md)`";
    assert.deepEqual(links(body), ["real"]);
  });

  it("does not link a concept to itself", () => {
    assert.deepEqual(links("[me](/dir/a.md)"), []);
  });

  it("keeps links to concepts that do not exist yet", () => {
    assert.deepEqual(links("[x](/not-written.md)"), ["not-written"]);
  });
});

describe("Bundle.load", () => {
  const root = mkdtempSync(path.join(tmpdir(), "okf-bundle-"));
  const put = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };
  const concept = (title: string) => `---\ntype: T\ntitle: ${title}\n---\nbody\n`;
  put("index.md", '---\nokf_version: "0.2"\n---\n# Root\n');
  put("real.md", concept("Real"));
  put("sub/deep.md", concept("Deep"));
  put("sub/index.md", "# Sub\n");
  put("sub/log.md", "# Log\n");
  put(".git/hidden.md", concept("Hidden"));
  put("node_modules/pkg/readme.md", concept("Vendored"));
  const outside = mkdtempSync(path.join(tmpdir(), "okf-outside-"));
  writeFileSync(path.join(outside, "secret.md"), concept("Secret"));
  symlinkSync(outside, path.join(root, "linked"));
  after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("loads concepts, treats index.md and log.md as reserved, and skips hidden and vendored directories", async () => {
    const b = new Bundle(root);
    await b.load();
    assert.deepEqual([...b.concepts.keys()].sort(), ["real", "sub/deep"]);
    assert.deepEqual([...b.indexes.keys()].sort(), ["", "sub"]);
  });

  it("does not follow symlinks out of the bundle", async () => {
    const b = new Bundle(root);
    await b.load();
    assert.equal(b.concepts.has("linked/secret"), false);
  });
});

describe("Bundle.search", () => {
  it("ranks title matches above body matches and breaks ties by ID", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "okf-search-"));
    const put = (rel: string, title: string, body: string) =>
      writeFileSync(path.join(root, rel), `---\ntype: T\ntitle: ${title}\n---\n${body}\n`);
    put("b.md", "Other", "mentions widget once");
    put("a.md", "Widget", "");
    put("c.md", "Another", "mentions widget once");
    try {
      const b = new Bundle(root);
      await b.load();
      assert.deepEqual(b.search("widget").map((h) => h.concept.id), ["a", "b", "c"]);
      assert.deepEqual(b.search("   "), []);
      assert.equal(b.search("widget", 1).length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
