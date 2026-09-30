import assert from "node:assert/strict";
import { after, it } from "node:test";
import { CLAUDE, concept, run, TestRepo } from "./testrepo.js";

// Reproduces the two commits of spec §16.1 and asserts the files of §16.2 to §16.5.

const repo = new TestRepo();
after(() => repo.cleanup());

const OLD = "{ by: claude-code/claude-sonnet-5-5, at: 2026-09-29T12:00:00Z }";
const NEW = "{ by: claude-code/claude-sonnet-5-5, at: 2026-09-29T10:22:51Z }";

const concepts: Record<string, { type: string; title: string; description: string }> = {
  "bakehouse/ember-index.md": { type: "Metric", title: "Ember Index", description: "A 0-100 score generated from oven temperature logs showing how stable the wood-fired oven's heat was overnight; a high score is bad." },
  "bakehouse/kettle-process.md": { type: "Process", title: "The Kettle Process", description: "The bakery's overnight sourdough routine, in which starter is fed and dough proves for about 14 hours in a steam-kettle-humidified cabinet before shaping and baking." },
  "bakehouse/nightwatch.md": { type: "System", title: "Nightwatch", description: "The overnight monitoring setup, temperature probes plus a duty baker, that watches the oven and proving cabinets, calculates the Ember Index, and flags anomalies in real time." },
  "wholesale-round/constellations.md": { type: "Concept", title: "Constellations", description: "The groupings used to organise wholesale cafe customers by delivery route, not by size or order volume." },
  "wholesale-round/the-wheel.md": { type: "Schedule", title: "The Wheel", description: "The weekly delivery rotation board showing which constellations receive bread on which days, and in what delivery order." },
  "wholesale-round/looming.md": { type: "Status", title: "Looming", description: "The status of a wholesale account whose standing order is approaching renewal or renegotiation, for example a 3-month bread supply agreement." },
  "shop-and-customer-line/michael.md": { type: "AI Agent", title: "Michael", description: "Hearth & Wheel's customer-facing AI telephone assistant, styled and voiced on TV presenter Michael McIntyre, who answers the bakery's public phone line." },
};

const fileFor = (c: { type: string; title: string; description: string }, generated: string) =>
  concept({ type: c.type, title: `"${c.title}"`, description: `"${c.description.replace(/"/g, '\\"')}"`, generated, status: "stable" }, "# Body\n\nText.\n");

const ROOT = `---
okf_version: "0.2"
---

# Subdirectories

* [bakehouse](bakehouse/index.md) - Production.
* [wholesale-round](wholesale-round/index.md) - Wholesale.
* [shop-and-customer-line](shop-and-customer-line/index.md) - Customer-facing.
`;

it("the first sync reproduces spec §16", async () => {
  for (const [p, c] of Object.entries(concepts)) repo.write(`kb/${p}`, fileFor(c, OLD));
  for (const d of ["bakehouse", "wholesale-round", "shop-and-customer-line"]) repo.write(`kb/${d}/index.md`, "# Hand-written\n");
  repo.write("kb/index.md", ROOT);
  repo.write("kb/log.md", "# Directory Update Log\n\n## 2026-09-29\n* **Creation**: Wrote the initial concepts.\n* **Initialization**: Created foundational directory structure.\n");
  repo.commit("Add the bundle", { at: "2026-09-29T11:41:53+01:00", name: "Stef", email: "git@sril.email", trailers: [CLAUDE] });
  for (const [p, c] of Object.entries(concepts)) repo.write(`kb/${p}`, fileFor(c, NEW));
  repo.commit("Update generated", { at: "2026-09-29T12:01:30+01:00", name: "Stef", email: "git@sril.email", trailers: [CLAUDE] });

  // No GitHub lookups are needed: both commits carry the Anthropic trailer.
  const res = await run(repo, "sync", { resolver: async () => { throw new Error("API should not be called"); } });
  assert.equal(res.code, 0, res.out);

  const GEN = "generated: { by: claude-code/claude-sonnet-5-5, at: 2026-09-29T10:41:53Z }";
  for (const [p, c] of Object.entries(concepts)) assert.equal(repo.read(`kb/${p}`), fileFor(c, NEW).replace(/generated: .*/, GEN), p);

  assert.equal(repo.read("kb/bakehouse/index.md"), `# Metric

* [Ember Index](ember-index.md) - ${concepts["bakehouse/ember-index.md"].description}

# Process

* [The Kettle Process](kettle-process.md) - ${concepts["bakehouse/kettle-process.md"].description}

# System

* [Nightwatch](nightwatch.md) - ${concepts["bakehouse/nightwatch.md"].description}
`);
  assert.equal(repo.read("kb/wholesale-round/index.md"), `# Concept

* [Constellations](constellations.md) - ${concepts["wholesale-round/constellations.md"].description}

# Schedule

* [The Wheel](the-wheel.md) - ${concepts["wholesale-round/the-wheel.md"].description}

# Status

* [Looming](looming.md) - ${concepts["wholesale-round/looming.md"].description}
`);
  assert.equal(repo.read("kb/shop-and-customer-line/index.md"), `# AI Agent

* [Michael](michael.md) - ${concepts["shop-and-customer-line/michael.md"].description}
`);
  assert.equal(repo.read("kb/log.md"), `# Directory Update Log

## 2026-09-29
* **Initialization**: Created the bundle.
* **Creation**: [Ember Index](/bakehouse/ember-index.md)
* **Creation**: [The Kettle Process](/bakehouse/kettle-process.md)
* **Creation**: [Nightwatch](/bakehouse/nightwatch.md)
* **Creation**: [Michael](/shop-and-customer-line/michael.md)
* **Creation**: [Constellations](/wholesale-round/constellations.md)
* **Creation**: [Looming](/wholesale-round/looming.md)
* **Creation**: [The Wheel](/wholesale-round/the-wheel.md)
`);
  assert.equal(repo.read("kb/index.md"), ROOT, "root index is unchanged");

  repo.commit("Sync OKF metadata", { name: "github-actions[bot]" });
  const check = await run(repo, "check");
  assert.equal(check.code, 0, check.out);
  assert.doesNotMatch(check.out, /W1/);
});
