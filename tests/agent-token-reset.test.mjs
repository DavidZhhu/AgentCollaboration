import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handle } from "../app/server.ts";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("drizzle")
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync("drizzle/" + file, "utf8"));
  }
  const db = {
    prepare(sql) {
      let parameters = [];
      return {
        bind(...values) {
          parameters = values;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...parameters) || null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...parameters) };
        },
        async run() {
          return sqlite.prepare(sql).run(...parameters);
        },
      };
    },
  };
  return { sqlite, db };
}

async function send(db, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  else headers["oai-authenticated-user-id"] = "test-owner";
  return handle(
    new Request("https://test.example/api/workspace", {
      method: "POST",
      headers,
      body: JSON.stringify({ project_id: "test-project", ...body }),
    }),
    db,
    Boolean(token),
  );
}

async function fixture() {
  const { sqlite, db } = database();
  assert.equal(
    (await send(db, { action: "project", name: "Test project" })).status,
    200,
  );
  const response = await send(db, {
    action: "agent",
    name: "R01",
    role: "R01",
    provider: "Claude Code",
  });
  const agent = await response.json();
  return { sqlite, db, agent };
}

async function health(db, token) {
  return handle(
    new Request("https://test.example/api/agent?status=1", {
      headers: { authorization: "Bearer " + token },
    }),
    db,
    true,
  );
}

test("reset replaces the token, revokes the old token and worker lease, and retains task history", async () => {
  const { sqlite, db, agent } = await fixture();
  try {
    await send(db, {
      action: "card",
      title: "Preserved task",
      description: "Read only",
      criteria: "Report",
      agent_id: agent.agent_id,
      priority: "low",
    });
    const before = sqlite.prepare("SELECT * FROM cards").all();
    sqlite
      .prepare(
        "UPDATE agents SET worker_id='test-worker',worker_seen=?,worker_status='running',worker_error='Previous error',last_seen=? WHERE id=?",
      )
      .run(Date.now(), Date.now(), agent.agent_id);
    const response = await send(db, {
      action: "reset_agent_token",
      agent_id: agent.agent_id,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const rotated = await response.json();
    assert.equal(rotated.agent_id, agent.agent_id);
    assert.match(rotated.token, /^ac_[a-f0-9]{64}$/);
    assert.notEqual(rotated.token, agent.token);
    assert.equal((await health(db, agent.token)).status, 401);
    const valid = await health(db, rotated.token);
    assert.equal(valid.status, 200);
    const state = await valid.json();
    assert.equal(state.agent.role, "R01");
    assert.equal(state.worker_online, false);
    assert.equal(state.worker_status, "stopped");
    assert.equal(state.worker_seen, null);
    assert.equal(state.worker_error, "");
    const stored = sqlite
      .prepare("SELECT * FROM agents WHERE id=?")
      .get(agent.agent_id);
    assert.notEqual(stored.token_hash, rotated.token);
    assert.equal(stored.last_seen, null);
    assert.equal(stored.worker_id, null);
    assert.deepEqual(sqlite.prepare("SELECT * FROM cards").all(), before);
    const second = await (
      await send(db, { action: "reset_agent_token", agent_id: agent.agent_id })
    ).json();
    assert.equal((await health(db, rotated.token)).status, 401);
    assert.equal((await health(db, second.token)).status, 200);
  } finally {
    sqlite.close();
  }
});

test("agents cannot reset tokens and unauthenticated callers are rejected", async () => {
  const { sqlite, db, agent } = await fixture();
  try {
    assert.equal(
      (
        await send(
          db,
          { action: "reset_agent_token", agent_id: agent.agent_id },
          agent.token,
        )
      ).status,
      403,
    );
    const response = await handle(
      new Request("https://test.example/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset_agent_token",
          project_id: "test-project",
          agent_id: agent.agent_id,
        }),
      }),
      db,
    );
    assert.equal(response.status, 401);
    assert.equal((await health(db, agent.token)).status, 200);
  } finally {
    sqlite.close();
  }
});

test("reset is scoped to the selected project and excludes deleted connections", async () => {
  const { sqlite, db, agent } = await fixture();
  try {
    await send(db, {
      action: "project",
      project_id: "other-project",
      name: "Other project",
    });
    assert.equal(
      (
        await send(db, {
          action: "reset_agent_token",
          project_id: "other-project",
          agent_id: agent.agent_id,
        })
      ).status,
      404,
    );
    assert.equal(
      (await send(db, { action: "reset_agent_token", agent_id: "" })).status,
      400,
    );
    assert.equal((await health(db, agent.token)).status, 200);
    await send(db, { action: "delete_agent", agent_id: agent.agent_id });
    assert.equal(
      (
        await send(db, {
          action: "reset_agent_token",
          agent_id: agent.agent_id,
        })
      ).status,
      404,
    );
  } finally {
    sqlite.close();
  }
});
