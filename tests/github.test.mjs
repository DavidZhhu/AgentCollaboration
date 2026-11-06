import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash, createHmac, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = mkdtempSync(path.join(tmpdir(), "agentcollab-github-tests-"));
await build({ entryPoints: ["app/github-server.ts", "lib/github-api.ts"], outdir: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
const { githubProject, githubWebhook, importantEvent } = await import(pathToFileURL(path.join(output, "app/github-server.js")));
const { verifyWebhook, appJwt } = await import(pathToFileURL(path.join(output, "lib/github-api.js")));
const originalFetch = globalThis.fetch;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const environment = { GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }), GITHUB_WEBHOOK_SECRET: "test-secret-not-a-real-credential" };
const repo = { id: 42, full_name: "example/private-project", private: true, default_branch: "main", description: "Private project", html_url: "https://github.com/example/private-project" };
let providerStatus = 200, tokenBodies = [], calls = [], providerGate = null, providerHeaders = {};
before(() => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options?.method || "GET" });
    if (providerGate) await providerGate(url);
    assert.ok(url.startsWith("https://api.github.com/"));
    if (url.endsWith("/access_tokens")) {
      tokenBodies.push(JSON.parse(options.body));
      return Response.json({ token: "fixture-token" });
    }
    assert.equal(options?.method || "GET", "GET", "The integration must never mutate GitHub resources");
    if (providerStatus !== 200) return Response.json({ message: "provider detail must not leak" }, { status: providerStatus, headers: providerHeaders });
    if (url.includes("/repos/example/private-project") && !url.includes("/private-project/")) return Response.json(repo);
    if (url.includes("/repositories/42")) return Response.json(repo);
    if (url.includes("/pulls?")) return Response.json([{ number: 1, title: "Private PR", html_url: `${repo.html_url}/pull/1`, state: "open", draft: false, merged_at: null, updated_at: "2026-11-06", head: { sha: "abc", ref: "feat/example" }, requested_reviewers: [{ login: "reviewer" }] }]);
    if (url.includes("/issues?")) return Response.json([{ number: 2, title: "Private issue", html_url: `${repo.html_url}/issues/2`, state: "open" }]);
    if (url.includes("/branches?")) return Response.json([{ name: "main", commit: { sha: "abc" }, protected: false }]);
    if (url.includes("/commits?")) return Response.json([{ sha: "abc", html_url: `${repo.html_url}/commit/abc`, commit: { message: "Private commit", author: { date: "2026-11-06" } } }]);
    if (url.includes("/actions/runs?")) return Response.json({ workflow_runs: [] });
    if (url.endsWith("/readme")) return Response.json({ encoding: "base64", content: Buffer.from("# Private README\n你好").toString("base64") });
    if (url.includes("/check-runs?")) return Response.json({ check_runs: [] });
    if (url.includes("/status?")) return Response.json({ statuses: [] });
    throw new Error(`Unexpected provider request: ${url}`);
  };
});
after(() => { globalThis.fetch = originalFetch; rmSync(output, { recursive: true, force: true }); });

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync("drizzle").filter(name => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(`drizzle/${name}`, "utf8"));
  const wrap = (sql, values = []) => ({
    bind: (...next) => wrap(sql, next),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ success: true, meta: sqlite.prepare(sql).run(...values) }),
    sql, values,
  });
  const db = { prepare: wrap, batch: async statements => {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map(statement => ({ results: sqlite.prepare(statement.sql).all(...statement.values) }));
      sqlite.exec("COMMIT"); return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  sqlite.exec("INSERT INTO projects (id,name,direction,repo,created_at) VALUES ('p','Example','','',1),('other','Other','','',1)");
  for (const [id, role] of [["owner", "owner"], ["member", "member"]]) {
    sqlite.prepare("INSERT INTO accounts (id,username,role,enabled,created_at) VALUES (?,?,?,1,1)").run(id, id, role);
    sqlite.prepare("INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)").run(createHash("sha256").update(id.repeat(64).slice(0,64).replace(/[^a-f0-9]/g, "a")).digest("hex"), id, Date.now() + 60000);
  }
  const request = (who = "owner", body, project = "p", origin = "https://app.example") => new Request(`https://app.example/api/github?project_id=${project}`, { method: body ? "POST" : "GET", headers: { cookie: `ac_session=${who.repeat(64).slice(0,64).replace(/[^a-f0-9]/g, "a")}`, origin, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { sqlite, db, request };
}
async function connect(fixture) {
  const response = await githubProject(fixture.request("owner", { action: "connect", installation_id: 7, full_name: repo.full_name }), fixture.db, environment);
  assert.equal(response.status, 200, await response.text());
}
function webhook(payload, event = "pull_request", delivery = randomUUID(), tampered = false) {
  const text = JSON.stringify(payload);
  return new Request("https://app.example/api/github/webhook", { method: "POST", body: tampered ? text + " " : text, headers: { "x-github-event": event, "x-github-delivery": delivery, "x-hub-signature-256": `sha256=${createHmac("sha256", environment.GITHUB_WEBHOOK_SECRET).update(text).digest("hex")}` } });
}
const review = { installation: { id: 7 }, repository: { id: 42 }, action: "review_requested", pull_request: { number: 1, title: "Private PR", html_url: `${repo.html_url}/pull/1` } };

test("Web Crypto accepts GitHub's published signature vector and rejects modifications", async () => {
  const signature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
  assert.equal(await verifyWebhook("It's a Secret to Everybody", signature, new TextEncoder().encode("Hello, World!")), true);
  assert.equal(await verifyWebhook("It's a Secret to Everybody", signature, new TextEncoder().encode("Hello, World?")), false);
  assert.equal(await verifyWebhook("secret", null, new Uint8Array()), false);
});
test("GitHub PKCS#1 keys produce a short-lived RS256 JWT", async () => {
  const token = await appJwt(environment);
  const [header, payload] = token.split(".").slice(0, 2).map(part => JSON.parse(Buffer.from(part, "base64url")));
  assert.equal(header.alg, "RS256"); assert.equal(payload.iss, "123"); assert.equal(payload.exp - payload.iat, 600);
});
test("anonymous and unassigned accounts cannot read private snapshots; authorized viewers can", async () => {
  const fixture = database(); await connect(fixture);
  assert.equal((await githubProject(new Request("https://app.example/api/github?project_id=p"), fixture.db, environment)).status, 401);
  const forbidden = await githubProject(fixture.request("member"), fixture.db, environment);
  assert.equal(forbidden.status, 403); assert.ok(!(await forbidden.text()).includes(repo.full_name));
  assert.equal((await githubProject(fixture.request("owner", { action: "member", account_id: "member", allowed: true }), fixture.db, environment)).status, 200);
  const response = await githubProject(fixture.request("member"), fixture.db, environment);
  assert.equal(response.status, 200); const view = await response.json();
  assert.equal(view.snapshot.repository.private, true); assert.match(view.snapshot.readme, /你好/);
  assert.equal(view.members, undefined); assert.ok(tokenBodies.some(body => body.repository_ids?.[0] === 42));
  assert.ok(tokenBodies.every(body => Object.values(body.permissions).every(value => value === "read")));
  assert.equal((await githubProject(fixture.request("member", { action: "disconnect" }), fixture.db, environment)).status, 403);
  assert.equal((await githubProject(fixture.request("member", undefined, "other"), fixture.db, environment)).status, 403);
  await githubProject(fixture.request("owner", { action: "member", account_id: "member", allowed: false }), fixture.db, environment);
  assert.equal((await githubProject(fixture.request("member"), fixture.db, environment)).status, 403);
});
test("signed webhook updates are scoped by repository and installation and duplicate delivery is idempotent", async () => {
  const fixture = database(); await connect(fixture);
  const delivery = randomUUID();
  const responses = await Promise.all([githubWebhook(webhook(review, "pull_request", delivery), fixture.db, environment), githubWebhook(webhook(review, "pull_request", delivery), fixture.db, environment)]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(fixture.sqlite.prepare("SELECT count(*) n FROM github_activity").get().n, 1);
  assert.equal(fixture.sqlite.prepare("SELECT version FROM github_connections").get().version, 2);
  await githubWebhook(webhook({ ...review, installation: { id: 99 } }), fixture.db, environment);
  assert.equal(fixture.sqlite.prepare("SELECT version FROM github_connections").get().version, 2);
  assert.equal((await githubWebhook(webhook(review, "pull_request", randomUUID(), true), fixture.db, environment)).status, 401);
  assert.equal(fixture.sqlite.prepare("SELECT version FROM github_connections").get().version, 2);
});
test("webhooks do not change task acceptance or agent conversations", async () => {
  const fixture = database(); await connect(fixture);
  await githubWebhook(webhook({ ...review, action: "closed", pull_request: { ...review.pull_request, merged: true } }), fixture.db, environment);
  assert.equal(fixture.sqlite.prepare("SELECT count(*) n FROM cards").get().n, 0);
  assert.equal(fixture.sqlite.prepare("SELECT count(*) n FROM messages").get().n, 0);
  assert.equal(fixture.sqlite.prepare("SELECT kind FROM github_activity").get().kind, "merge");
});
test("revoked App access clears private data and hides historical activity", async () => {
  const fixture = database(); await connect(fixture);
  await githubProject(fixture.request(), fixture.db, environment);
  await githubWebhook(webhook(review), fixture.db, environment);
  await githubWebhook(webhook({ action: "suspend", installation: { id: 7 } }, "installation"), fixture.db, environment);
  const view = await (await githubProject(fixture.request(), fixture.db, environment)).json();
  assert.equal(view.snapshot, null); assert.deepEqual(view.activities, []); assert.match(view.connection.last_error, /revoked/);
});
test("provider permission failure clears cached private data without exposing provider error details", async () => {
  const fixture = database(); await connect(fixture);
  await githubProject(fixture.request(), fixture.db, environment);
  await githubWebhook(webhook(review), fixture.db, environment);
  providerStatus = 403;
  try {
    const view = await (await githubProject(fixture.request(), fixture.db, environment)).json();
    assert.equal(view.snapshot, null); assert.deepEqual(view.activities, []); assert.doesNotMatch(view.connection.last_error, /provider detail/);
    const count = calls.length; await githubProject(fixture.request(), fixture.db, environment); assert.equal(calls.length, count, "Respect retry timing");
  } finally { providerStatus = 200; }
});
test("reconnection clears the previous snapshot and feed; cross-origin writes are rejected", async () => {
  const fixture = database(); await connect(fixture);
  await githubProject(fixture.request(), fixture.db, environment);
  await githubWebhook(webhook(review), fixture.db, environment);
  assert.equal((await githubProject(fixture.request("owner", { action: "disconnect" }, "p", "https://evil.example"), fixture.db, environment)).status, 403);
  const previous = fixture.sqlite.prepare("SELECT generation FROM github_connections").get().generation;
  await connect(fixture);
  const current = fixture.sqlite.prepare("SELECT generation,snapshot FROM github_connections").get();
  assert.notEqual(previous, current.generation); assert.equal(current.snapshot, null);
  assert.equal(fixture.sqlite.prepare("SELECT count(*) n FROM github_activity").get().n, 0);
});
test("ordinary commits and successful checks stay out of the important activity feed", () => {
  assert.equal(importantEvent("push", {}), null);
  assert.equal(importantEvent("check_run", { action: "completed", check_run: { conclusion: "success" } }), null);
  assert.equal(importantEvent("check_run", { action: "completed", check_run: { conclusion: "failure", name: "Build" } }).kind, "failure");
});

test("a revoked viewer receives no data when authorization changes during a slow sync", async () => {
  const fixture = database(); await connect(fixture);
  await githubProject(fixture.request("owner", { action: "member", account_id: "member", allowed: true }), fixture.db, environment);
  let release, started;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  providerGate = async url => { if (url.endsWith("/readme")) { started(); await held; } };
  try {
    const pending = githubProject(fixture.request("member"), fixture.db, environment);
    await ready;
    fixture.sqlite.prepare("DELETE FROM github_project_members WHERE account_id='member'").run();
    release();
    const response = await pending;
    assert.equal(response.status, 403); assert.ok(!(await response.text()).includes("Private README"));
  } finally { release(); providerGate = null; }
});
test("an old in-flight sync cannot replace a newly connected repository generation", async () => {
  const fixture = database(); await connect(fixture);
  let release, started;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  providerGate = async url => { if (url.endsWith("/readme")) { started(); await held; } };
  try {
    const pending = githubProject(fixture.request(), fixture.db, environment);
    await ready;
    await connect(fixture);
    release(); await pending;
    assert.equal(fixture.sqlite.prepare("SELECT snapshot FROM github_connections").get().snapshot, null);
  } finally { release(); providerGate = null; }
});
test("rate-limited reads retain a clearly stale snapshot and defer retries", async () => {
  const fixture = database(); await connect(fixture);
  await githubProject(fixture.request(), fixture.db, environment);
  await githubWebhook(webhook(review), fixture.db, environment);
  providerStatus = 403; providerHeaders = { "x-ratelimit-remaining": "0", "retry-after": "120" };
  try {
    const view = await (await githubProject(fixture.request(), fixture.db, environment)).json();
    assert.equal(view.snapshot.repository.id, 42); assert.match(view.connection.last_error, /rate limit/);
    const count = calls.length; await githubProject(fixture.request(), fixture.db, environment); assert.equal(calls.length, count);
  } finally { providerStatus = 200; providerHeaders = {}; }
});
test("repository removal disables every matching connection and missed webhooks recover on read", async () => {
  const fixture = database(); await connect(fixture);
  await githubProject(fixture.request(), fixture.db, environment);
  fixture.sqlite.prepare("UPDATE github_connections SET last_sync=?").run(Date.now() - 360000);
  const before = calls.length; await githubProject(fixture.request(), fixture.db, environment); assert.ok(calls.length > before);
  const removed = { action: "removed", installation: { id: 7 }, repositories_removed: [{ id: 42 }] };
  assert.equal((await githubWebhook(webhook(removed, "installation_repositories"), fixture.db, environment)).status, 200);
  const current = fixture.sqlite.prepare("SELECT snapshot,active FROM github_connections").get();
  assert.equal(current.snapshot, null); assert.equal(current.active, 0);
});
