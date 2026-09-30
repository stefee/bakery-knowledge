import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { CLAUDE, concept, run, TestRepo } from "./testrepo.js";

const repos: TestRepo[] = [];
const fresh = () => (repos.push(new TestRepo()), repos[repos.length - 1]);
after(() => repos.forEach((r) => r.cleanup()));
const at = (day: string) => ({ at: `${day}T12:00:00+00:00`, trailers: [CLAUDE] });
const big = "A long enough body that git's rename detection stays confident.\n".repeat(8);

async function log(r: TestRepo): Promise<string> {
  await run(r, "sync");
  return r.read("kb/log.md");
}

describe("log.md (spec §7)", () => {
  it("writes each kind of entry, newest day first, with linking and ordering rules", async () => {
    const r = fresh();
    r.write("kb/dir/a.md", concept({ type: "T", title: "A" }, big));
    r.write("kb/dir/b.md", concept({ type: "T", title: "B" }));
    r.write("kb/dir/c.md", concept({ type: "T", title: "C" }));
    r.commit("day 1", at("2026-02-01"));
    r.write("kb/dir/a.md", concept({ type: "T", title: "A" }, big + "More.\n"));
    r.write("kb/dir/b.md", concept({ type: "T", title: "B", status: "deprecated" }));
    r.remove("kb/dir/c.md");
    r.commit("day 2", at("2026-02-02"));
    r.move("kb/dir/a.md", "kb/sub/a.md");
    r.commit("pure move", at("2026-02-03"));
    r.write("kb/dir/b.md", concept({ type: "T", title: "B", status: "deprecated", verified: "[{ by: human:x, at: 2026-02-03T00:00:00Z }]" }));
    r.commit("verify only", at("2026-02-03"));
    r.write("kb/dir/d.md", concept({ type: "T", title: "D" }, "one\n"));
    r.commit("create d", at("2026-02-04"));
    r.write("kb/dir/d.md", concept({ type: "T", title: "D" }, "two\n"));
    r.commit("edit d", at("2026-02-04"));

    assert.equal(
      await log(r),
      `# Directory Update Log

## 2026-02-04
* **Creation**: [D](/dir/d.md)

## 2026-02-02
* **Update**: [A](/sub/a.md)
* **Deprecation**: [B](/dir/b.md)
* **Removal**: C (\`dir/c.md\`)

## 2026-02-01
* **Initialization**: Created the bundle.
* **Creation**: [B](/dir/b.md)
* **Creation**: C (\`dir/c.md\`)
* **Creation**: [A](/sub/a.md)
`,
    );
  });

  it("treats delete and re-add at the same path as a new concept", async () => {
    const r = fresh();
    r.write("kb/d/a.md", concept({ type: "T", title: "Old" }));
    r.commit("one", at("2026-03-01"));
    r.remove("kb/d/a.md");
    r.commit("two", at("2026-03-02"));
    r.write("kb/d/a.md", concept({ type: "T", title: "New" }));
    r.commit("three", at("2026-03-03"));
    assert.equal(
      await log(r),
      `# Directory Update Log

## 2026-03-03
* **Creation**: [New](/d/a.md)

## 2026-03-02
* **Removal**: Old (\`d/a.md\`)

## 2026-03-01
* **Initialization**: Created the bundle.
* **Creation**: Old (\`d/a.md\`)
`,
    );
  });

  it("lets Creation win over Removal and Update on the same day", async () => {
    const r = fresh();
    r.write("kb/d/a.md", concept({ type: "T", title: "A" }, "1\n"));
    r.commit("one", at("2026-03-01"));
    r.write("kb/d/a.md", concept({ type: "T", title: "A" }, "2\n"));
    r.commit("two", at("2026-03-01"));
    r.remove("kb/d/a.md");
    r.commit("three", at("2026-03-01"));
    assert.equal(await log(r), "# Directory Update Log\n\n## 2026-03-01\n* **Initialization**: Created the bundle.\n* **Creation**: A (`d/a.md`)\n");
  });

  it("uses the author date in UTC to pick the day", async () => {
    const r = fresh();
    r.write("kb/d/a.md", concept({ type: "T", title: "A" }));
    r.commit("one", { at: "2026-03-01T23:30:00-05:00", trailers: [CLAUDE] });
    assert.match(await log(r), /## 2026-03-02\n/);
  });

  it("is identical when regenerated", async () => {
    const r = fresh();
    r.write("kb/d/a.md", concept({ type: "T", title: "A" }));
    r.commit("one", at("2026-03-01"));
    const first = await log(r);
    assert.equal(await log(r), first);
  });
});
