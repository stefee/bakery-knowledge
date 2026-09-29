import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js");
const bundleDir = mkdtempSync(path.join(tmpdir(), "okf-http-"));
writeFileSync(
  path.join(bundleDir, "widget.md"),
  "---\ntype: Thing\ntitle: Widget\ndescription: A test widget.\n---\nAbout widgets.\n",
);
after(() => rmSync(bundleDir, { recursive: true, force: true }));

const run = (env: Record<string, string>) =>
  spawnSync(process.execPath, [entry], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8", timeout: 10_000 });

describe("configuration errors", () => {
  it("requires OKF_BUNDLE_PATH", () => {
    const r = run({});
    assert.equal(r.status, 1);
    assert.match(r.stderr, /OKF_BUNDLE_PATH is required/);
  });

  it("rejects an unknown OKF_TRANSPORT instead of silently using http", () => {
    const r = run({ OKF_BUNDLE_PATH: bundleDir, OKF_TRANSPORT: "stdi" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /OKF_TRANSPORT must be/);
  });

  it("rejects a PORT that is not a valid port number", () => {
    for (const PORT of ["abc", "70000", "-1", "1.5"]) {
      const r = run({ OKF_BUNDLE_PATH: bundleDir, PORT });
      assert.equal(r.status, 1, `PORT=${PORT}`);
      assert.match(r.stderr, /PORT must be/);
    }
  });
});

describe("HTTP transport", () => {
  let child: ChildProcess;
  let base: string;

  before(async () => {
    child = spawn(process.execPath, [entry], {
      env: { PATH: process.env.PATH ?? "", OKF_BUNDLE_PATH: bundleDir, PORT: "0" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    base = await new Promise<string>((resolve, reject) => {
      let seen = "";
      child.stderr!.on("data", (chunk) => {
        seen += chunk;
        const m = /listening on (http:\/\/[^\s/]+)\/mcp/.exec(seen);
        if (m) resolve(m[1]);
      });
      child.on("exit", (code) => reject(new Error(`server exited early (${code}): ${seen}`)));
    });
  });
  after(() => child.kill());

  const rpc = (url: string, init: RequestInit = {}) =>
    fetch(base + url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      ...init,
    });
  const call = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "search_knowledge", arguments: { query: "widget" } },
  });

  it("binds to loopback by default", () => {
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("answers GET /healthz and rejects other methods with 405", async () => {
    assert.equal((await fetch(base + "/healthz")).status, 200);
    const post = await fetch(base + "/healthz", { method: "POST" });
    assert.equal(post.status, 405);
  });

  it("serves tool calls on POST /mcp, including with a query string", async () => {
    for (const url of ["/mcp", "/mcp?x=1"]) {
      const res = await rpc(url, { body: call });
      assert.equal(res.status, 200, url);
      assert.match(await res.text(), /widget \[Thing\]/);
    }
  });

  it("rejects GET and DELETE on /mcp with 405 and an Allow header", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(base + "/mcp", { method });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get("allow"), "POST");
    }
  });

  it("returns 404 for unknown paths and 400 for malformed JSON, and stays up", async () => {
    assert.equal((await fetch(base + "/nope")).status, 404);
    assert.equal((await rpc("/mcp", { body: "{not json" })).status, 400);
    assert.equal((await fetch(base + "/healthz")).status, 200);
  });
});
