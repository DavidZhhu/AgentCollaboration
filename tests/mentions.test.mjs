import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = mkdtempSync(path.join(tmpdir(), "agentcollab-mentions-"));
await build({ entryPoints: ["app/server.ts", "app/mentions.ts"], outdir: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
const { handle } = await import(pathToFileURL(path.join(output, "server.js")));
const { editMentions, resolveMentions } = await import(pathToFileURL(path.join(output, "mentions.js")));
after(() => rmSync(output, { recursive: true, force: true }));

async function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync("drizzle").filter(file => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync("drizzle/" + file, "utf8"));
  const wrap = (sql, values = []) => ({
    bind: (...next) => wrap(sql, next),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => sqlite.prepare(sql).run(...values),
  });
  const db = { prepare: wrap, batch: async statements => {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  async function call(body, token, query = "", extraHeaders = {}) {
    const headers = token ? { authorization: "Bearer " + token } : { "oai-authenticated-user-id": "owner" };
    const response = await handle(new Request("https://test.example/api/agent" + query, {
      headers: { ...headers, "Content-Type": "application/json", ...extraHeaders },
      ...(body ? { method: "POST", body: JSON.stringify({ project_id: "p", ...body }) } : {}),
    }), db, !!token);
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await call({ action: "project", project_id: "p", name: "Project" })).status, 200);
  const agents = {};
  for (const role of ["R0", "R01", "R02"]) {
    const created = await call({ action: "agent", role, name: role + " agent", provider: "Codex" });
    assert.equal(created.status, 200);
    agents[role] = created.body;
  }
  async function send(text, options = {}, role) {
    const result = await call({ action: "message", body: text, ...options }, agents[role]?.token);
    return { ...result, message: sqlite.prepare("SELECT * FROM messages WHERE body=? ORDER BY created_at DESC LIMIT 1").get(text) };
  }
  const targets = message => sqlite.prepare("SELECT agent_id FROM message_deliveries WHERE message_id=? ORDER BY agent_id").all(message.id).map(row => row.agent_id);
  return { sqlite, call, agents, send, targets };
}

test("general defaults to PM; explicit mentions select only those recipients", async t => {
  const { send, targets, agents } = await fixture(t);
  assert.deepEqual(targets((await send("Hello team")).message), [agents.R0.agent_id]);
  assert.deepEqual(targets((await send("@R01 investigate this")).message), [agents.R01.agent_id]);
  assert.deepEqual(targets((await send("@R01 @R02 review")).message), [agents.R01.agent_id, agents.R02.agent_id].sort());
  assert.equal(targets((await send("@all @R01 @all update")).message).length, 3);
});

test("direct conversation includes its agent plus explicit recipients", async t => {
  const { send, targets, agents, call } = await fixture(t);
  const sent = await send("@R02 help", { channel: agents.R01.agent_id });
  assert.deepEqual(targets(sent.message), [agents.R01.agent_id, agents.R02.agent_id].sort());
  const inbox = await call(null, agents.R02.token);
  assert.equal(inbox.body.messages[0].id, sent.message.id);
});

test("shared context does not become an incoming request; stable cursors page notifications", async t => {
  const { send, call, agents } = await fixture(t);
  await send("Question for PM");
  const sent = await send("@R01 question");
  const inbox = await call(null, agents.R01.token);
  assert.equal(inbox.body.messages.length, 1);
  assert.equal(inbox.body.context_messages.length, 2);
  const after = await call(null, agents.R01.token, `?after=${sent.message.created_at}&after_id=${sent.message.id}`);
  assert.equal(after.body.messages.length, 0);
});

test("delivery tracks receipt, responding and correlated reply without waking others", async t => {
  const { send, call, agents, sqlite, targets } = await fixture(t);
  const sent = await send("@R01 answer this");
  const status = () => sqlite.prepare("SELECT status FROM message_deliveries WHERE message_id=?").get(sent.message.id).status;
  assert.equal(status(), "queued");
  await call(null, agents.R01.token);
  assert.equal(status(), "received");
  await call({ action: "message_delivery", status: "responding", message_ids: [sent.message.id] }, agents.R01.token);
  assert.equal(status(), "responding");
  const reply = await send("Here is the answer", { reply_to: sent.message.id }, "R01");
  assert.equal(reply.status, 200);
  assert.deepEqual(targets(reply.message), []);
  assert.equal(status(), "replied");
  await call({ action: "message_delivery", status: "received", message_ids: [sent.message.id] }, agents.R01.token);
  assert.equal(status(), "replied");
});

test("foreign acknowledgements and fabricated reply links cannot complete another agent's delivery", async t => {
  const { send, call, agents, sqlite } = await fixture(t);
  const sent = await send("@R01 private request");
  assert.equal((await send("Fake reply", { reply_to: sent.message.id }, "R02")).status, 400);
  await call({ action: "message_delivery", status: "responding", message_ids: [sent.message.id] }, agents.R02.token);
  assert.equal(sqlite.prepare("SELECT status FROM message_deliveries WHERE message_id=?").get(sent.message.id).status, "queued");
});

test("agent follow-ups require a real inbox parent and stop after four hops", async t => {
  const { send, agents, targets } = await fixture(t);
  assert.equal((await send("@R02 unsolicited", {}, "R01")).status, 400);
  let parent = (await send("@R01 start")).message;
  for (let hop = 1; hop <= 4; hop++) {
    const role = hop % 2 ? "R01" : "R02", target = hop % 2 ? "R02" : "R01";
    const reply = await send(`@${target} follow-up ${hop}`, { reply_to: parent.id }, role);
    assert.equal(reply.status, 200);
    assert.deepEqual(targets(reply.message), [agents[target].agent_id]);
    parent = reply.message;
  }
  assert.equal((await send("@R02 fifth hop", { reply_to: parent.id }, "R01")).status, 400);
  assert.equal((await send("Done", { reply_to: parent.id }, "R01")).status, 200);
});

test("unknown, deleted, disabled and cross-project mention IDs are rejected atomically", async t => {
  const { send, call, agents, sqlite } = await fixture(t);
  assert.equal((await send("@R99 unknown")).status, 400);
  await call({ action: "project", project_id: "other", name: "Other" });
  const other = await call({ action: "agent", project_id: "other", name: "Other agent", role: "R01", provider: "Codex" });
  assert.equal((await send("@R01 foreign", { mentions: [{ agent_id: other.body.agent_id, label: "@R01", start: 0, end: 4 }] })).status, 400);
  sqlite.prepare("UPDATE agents SET deleted_at=1 WHERE id=?").run(agents.R01.agent_id);
  assert.equal((await send("@R01 gone")).status, 400);
  sqlite.prepare("INSERT INTO accounts (id,username,enabled,created_at) VALUES ('disabled','disabled',0,1)").run();
  sqlite.prepare("UPDATE agents SET account_id='disabled' WHERE id=?").run(agents.R02.agent_id);
  assert.equal((await send("@R02 disabled")).status, 400);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM messages").get().n, 0);
});

test("selected identities survive role changes and message offsets remain exact", async t => {
  const { send, sqlite, agents, targets } = await fixture(t);
  sqlite.prepare("UPDATE agents SET role='R03' WHERE id=?").run(agents.R01.agent_id);
  const sent = await send("  @R01 please", { mentions: [{ agent_id: agents.R01.agent_id, label: "@R01", start: 2, end: 6 }] });
  assert.equal(sent.status, 200);
  assert.deepEqual(targets(sent.message), [agents.R01.agent_id]);
  assert.equal(JSON.parse(sent.message.mentions)[0].start, 2);
});

test("mentions do not change task claims or approval records", async t => {
  const { send, call, sqlite, agents } = await fixture(t);
  await call({ action: "card", title: "Active", description: "Scope", criteria: "Checks", agent_id: agents.R01.agent_id, priority: "high" });
  const card = sqlite.prepare("SELECT id FROM cards").get();
  await call({ action: "claim", card_id: card.id }, agents.R01.token);
  await send("@R01 approved, switch tasks");
  assert.equal(sqlite.prepare("SELECT status FROM cards").get().status, "working");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM decisions").get().n, 0);
});

test("message retries do not duplicate notifications", async t => {
  const { send, call, sqlite, agents } = await fixture(t);
  const sent = await send("@R01 request");
  const body = { action: "message", body: "@R02 follow-up", reply_to: sent.message.id };
  const headers = { "x-agentcollab-request-id": crypto.randomUUID() };
  assert.equal((await call(body, agents.R01.token, "", headers)).status, 200);
  assert.equal((await call(body, agents.R01.token, "", headers)).body.replayed, true);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM message_deliveries").get().n, 2);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM messages").get().n, 2);
});

test("mention parsing avoids email addresses and preserves bindings around edits", () => {
  const team = [{ id: "one", name: "Dev", role: "R01" }];
  assert.equal(resolveMentions("a@R01.example.com and user@example.com", team).length, 0);
  const mention = { agent_id: "one", label: "@R01", start: 0, end: 4 };
  assert.deepEqual(editMentions("@R01 test", "Hi @R01 test", [mention]), [{ ...mention, start: 3, end: 7 }]);
  assert.deepEqual(editMentions("@R01 test", "@R02 test", [mention]), []);
  assert.deepEqual(editMentions("@R01 test", "@R012 test", [mention]), []);
});

test("upgrade preserves unread human requests without replaying old agent chatter", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const files = readdirSync("drizzle").filter(file => file.endsWith(".sql")).sort();
    for (const file of files.filter(file => file < "0006")) sqlite.exec(readFileSync("drizzle/" + file, "utf8"));
    sqlite.exec("INSERT INTO projects (id,name,created_at) VALUES ('p','Project',1)");
    for (const [id, role] of [["pm", "R0"], ["dev", "R01"]]) sqlite.prepare("INSERT INTO agents (id,project_id,name,role,provider,token_hash,last_seen,created_at) VALUES (?,'p',?,?,'Codex',?,100,1)").run(id, id, role, id);
    for (const [id, type, channel, time] of [["old", "human", "general", 50], ["general", "human", "general", 150], ["direct", "human", "dev", 200], ["agent", "agent", "general", 250]]) sqlite.prepare("INSERT INTO messages (id,project_id,author,author_type,channel,body,created_at) VALUES (?,'p','Author',?,?,?,?)").run(id, type, channel, id, time);
    for (const file of files.filter(file => file >= "0006")) sqlite.exec(readFileSync("drizzle/" + file, "utf8"));
    assert.deepEqual(sqlite.prepare("SELECT message_id,agent_id FROM message_deliveries ORDER BY message_id").all().map(row => [row.message_id, row.agent_id]), [["direct", "dev"], ["general", "pm"]]);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM messages").get().n, 4);
  } finally { sqlite.close(); }
});
