import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { resolveProjectSelection } from "../app/project-selection.ts";
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

test("project settings validate input and preserve direction and task history through deletion and restoration", async () => {
  const { sqlite, db } = await fixture();
  try {
    sqlite.prepare("UPDATE projects SET direction='Approved direction' WHERE id='test-project'").run();
    await send(db, { action: "card", title: "Existing task", description: "Keep", criteria: "Keep", priority: "low" });
    const cards = sqlite.prepare("SELECT * FROM cards").all();
    assert.equal((await send(db, { action: "update_project", name: " Renamed ", description: " Description ", repo: "https://github.com/team/repo" })).status, 200);
    const project = sqlite.prepare("SELECT * FROM projects WHERE id='test-project'").get();
    assert.equal(project.name, "Renamed");
    assert.equal(project.description, "Description");
    assert.equal(project.repo, "https://github.com/team/repo");
    assert.equal(project.direction, "Approved direction");
    for (const invalid of [{ name: "" }, { repo: "javascript:alert(1)" }, { repo: "https://github.com/team/repo/issues" }, { description: "x".repeat(5001) }]) {
      assert.equal((await send(db, { action: "update_project", name: "Renamed", ...invalid })).status, 400);
    }
    assert.equal((await send(db, { action: "delete_project" })).status, 200);
    assert.equal((await send(db, { action: "update_project", name: "Forbidden" })).status, 404);
    assert.equal((await send(db, { action: "restore_project" })).status, 200);
    assert.deepEqual(sqlite.prepare("SELECT * FROM projects WHERE id='test-project'").get(), project);
    assert.deepEqual(sqlite.prepare("SELECT * FROM cards").all(), cards);
  } finally { sqlite.close(); }
});
test("agents cannot edit project settings and unknown projects are rejected", async () => {
  const { sqlite, db, agent } = await fixture();
  try {
    assert.equal((await send(db, { action: "update_project", name: "Forbidden" }, agent.token)).status, 403);
    assert.equal((await send(db, { action: "update_project", project_id: "missing", name: "Missing" })).status, 404);
    assert.equal(sqlite.prepare("SELECT name FROM projects WHERE id='test-project'").get().name, "Test project");
  } finally { sqlite.close(); }
});

test("project selection survives refresh, isolates accounts, and falls back after deletion", () => {
  const projects = [{ id: "first" }, { id: "second" }];
  const storage = { getItem: (key) => key === "agentcollab:project:owner" ? "second" : null };
  assert.equal(resolveProjectSelection(projects, "", "owner", storage), "second");
  assert.equal(resolveProjectSelection(projects, "first", "owner", storage), "first");
  assert.equal(resolveProjectSelection(projects, "", "other", storage), "first");
  assert.equal(resolveProjectSelection([{ id: "first" }], "second", "owner", storage), "first");
  assert.equal(resolveProjectSelection([], "second", "owner", storage), "");
  assert.equal(resolveProjectSelection(projects, "", "owner", { getItem() { throw new Error("Blocked"); } }), "first");
});
