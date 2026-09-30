import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConceptInfo, renderFolderIndexes } from "./indexes.js";

const c = (path: string, type: string, title: string, description?: string): ConceptInfo => ({ path, type, title, description });

describe("folder indexes (spec §6.1)", () => {
  it("groups by type and sorts groups and entries case-insensitively", () => {
    const out = renderFolderIndexes([
      c("d/b.md", "process", "beta", "Two"),
      c("d/a.md", "Process", "Alpha"),
      c("d/m.md", "Metric", "Zed", "Z."),
      c("d/n.md", "Metric", "apple", "A."),
    ]);
    assert.equal(out.get("d"), "# Metric\n\n* [apple](n.md) - A.\n* [Zed](m.md) - Z.\n\n# Process\n\n* [Alpha](a.md)\n\n# process\n\n* [beta](b.md) - Two\n");
  });
  it("collapses whitespace in descriptions and omits a missing one", () => {
    const out = renderFolderIndexes([c("d/a.md", "T", "A", "one\n  two   three"), c("d/b.md", "T", "B")]);
    assert.equal(out.get("d"), "# T\n\n* [A](a.md) - one two three\n* [B](b.md)\n");
  });
  it("lists subdirectories last and indexes intermediate directories", () => {
    const out = renderFolderIndexes([c("d/a.md", "T", "A"), c("d/x/y/deep.md", "T", "Deep")]);
    assert.equal(out.get("d"), "# T\n\n* [A](a.md)\n\n# Subdirectories\n\n* [x](x/index.md)\n");
    assert.equal(out.get("d/x"), "# Subdirectories\n\n* [y](y/index.md)\n");
    assert.equal(out.get("d/x/y"), "# T\n\n* [Deep](deep.md)\n");
  });
  it("makes no index for the root or for directories without concepts", () => {
    const out = renderFolderIndexes([c("top.md", "T", "Top")]);
    assert.equal(out.size, 0);
  });
});
