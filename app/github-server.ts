import { currentAccount, type Account } from "./auth";
import { configured, GithubError, repositoryOptions, selectedRepository, snapshot, verifyWebhook, type GithubEnvironment } from "../lib/github-api";
import type { GithubSnapshot } from "../lib/github-types";

interface Connection {
  project_id: string; generation: string; repository_id: number; installation_id: number;
  full_name: string; snapshot: string | null; version: number; synced_version: number;
  last_sync: number | null; last_webhook: number | null; last_error: string; retry_at: number; lock_until: number; active: number;
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
async function readBody(request: Request, maximum: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get("content-length")) > maximum) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}
async function connection(db: D1Database, projectId: string) {
  return db.prepare("SELECT * FROM github_connections WHERE project_id=?").bind(projectId).first<Connection>();
}
async function canRead(db: D1Database, account: Account, projectId: string): Promise<boolean> {
  if (account.role === "owner") return true;
  return !!await db.prepare("SELECT 1 FROM github_project_members WHERE project_id=? AND account_id=?").bind(projectId, account.id).first();
}
async function refresh(db: D1Database, env: GithubEnvironment, current: Connection): Promise<void> {
  const now = Date.now();
  if (!current.active || current.retry_at > now || (current.synced_version >= current.version && (current.last_sync || 0) > now - 300000)) return;
  const lock = now + 120000;
  const claimed = await db.prepare("UPDATE github_connections SET lock_until=? WHERE project_id=? AND generation=? AND lock_until<? RETURNING project_id")
    .bind(lock, current.project_id, current.generation, now).first();
  if (!claimed) return;
  try {
    const data = await snapshot(env, current.installation_id, current.repository_id);
    await db.prepare("UPDATE github_connections SET snapshot=?,full_name=?,last_sync=?,synced_version=?,last_error='',retry_at=0,lock_until=0 WHERE project_id=? AND generation=? AND lock_until=? AND active=1")
      .bind(JSON.stringify(data), data.repository.full_name, Date.now(), current.version, current.project_id, current.generation, lock).run();
  } catch (error) {
    const denied = error instanceof GithubError && [401, 403, 404].includes(error.status);
    await db.prepare("UPDATE github_connections SET snapshot=CASE WHEN ? THEN NULL ELSE snapshot END,last_error=?,retry_at=?,lock_until=0 WHERE project_id=? AND generation=? AND lock_until=?")
      .bind(denied ? 1 : 0, error instanceof GithubError ? error.message : "Sync failed. Please retry later.", error instanceof GithubError ? error.retryAt : Date.now() + 60000, current.project_id, current.generation, lock).run();
  }
}
export async function githubProject(request: Request, db: D1Database, env: GithubEnvironment) {
  try {
    const account = await currentAccount(request, db);
    if (!account) return reply({ error: "Please sign in." }, 401);
    const url = new URL(request.url);
    const projectId = url.searchParams.get("project_id");
    if (!projectId || projectId.length > 100 || !await db.prepare("SELECT id FROM projects WHERE id=? AND deleted_at IS NULL").bind(projectId).first()) return reply({ error: "Project not found." }, 404);
    const owner = account.role === "owner";
    if (!await canRead(db, account, projectId)) return reply({ error: "The project owner must grant you access to this project's GitHub information." }, 403);
    if (request.method === "GET") {
      if (url.searchParams.get("repositories") === "1") {
        if (!owner) return reply({ error: "Owner access required." }, 403);
        if (!configured(env)) return reply({ error: "Configure the GitHub App first." }, 503);
        return reply(await repositoryOptions(env));
      }
      const current = await connection(db, projectId);
      if (current && configured(env)) await refresh(db, env, current);
      const updated = current ? await connection(db, projectId) : null;
      // Recheck grants after potentially slow provider calls; revocation takes effect on every response.
      const latestAccount = await currentAccount(request, db);
      if (!latestAccount || !await canRead(db, latestAccount, projectId) || !await db.prepare("SELECT id FROM projects WHERE id=? AND deleted_at IS NULL").bind(projectId).first()) return reply({ error: "Access revoked." }, 403);
      const activity = updated?.active && updated.snapshot ? await db.prepare("SELECT id,kind,title,url,created_at FROM github_activity WHERE project_id=? AND generation=? ORDER BY created_at DESC,id DESC LIMIT 50").bind(projectId, updated.generation).all() : { results: [] };
      const members = owner ? await db.prepare("SELECT accounts.id,accounts.username,EXISTS(SELECT 1 FROM github_project_members WHERE project_id=? AND account_id=accounts.id) AS allowed FROM accounts WHERE enabled=1 AND role='member' ORDER BY username").bind(projectId).all() : { results: undefined };
      return reply({ configured: configured(env), owner, connected: !!updated, connection: updated ? { full_name: updated.full_name, last_sync: updated.last_sync, last_error: updated.last_error, pending: updated.version > updated.synced_version, last_webhook: updated.last_webhook } : undefined,
        snapshot: updated?.active && updated.snapshot ? JSON.parse(updated.snapshot) as GithubSnapshot : null, activities: activity.results, members: members.results });
    }
    if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
    if (!owner) return reply({ error: "Only the owner can connect repositories and manage project viewers." }, 403);
    if (request.headers.get("origin") !== url.origin || !request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Same-origin JSON required." }, 403);
    const raw = await readBody(request, 4096);
    if (!raw) return reply({ error: "Request too large." }, 413);
    const body = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
    if (body.action === "connect") {
      if (!configured(env)) return reply({ error: "Configure the GitHub App first." }, 503);
      const installationId = Number(body.installation_id);
      const repo = await selectedRepository(env, installationId, String(body.full_name || ""));
      const generation = crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO github_connections (project_id,generation,repository_id,installation_id,full_name) VALUES (?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET generation=excluded.generation,repository_id=excluded.repository_id,installation_id=excluded.installation_id,full_name=excluded.full_name,snapshot=NULL,version=1,synced_version=0,last_sync=NULL,last_webhook=NULL,last_error='',retry_at=0,lock_until=0,active=1").bind(projectId, generation, repo.id, installationId, repo.full_name),
        db.prepare("DELETE FROM github_activity WHERE project_id=?").bind(projectId),
      ]);
      return reply({ ok: true });
    }
    if (body.action === "disconnect") {
      await db.batch([db.prepare("DELETE FROM github_connections WHERE project_id=?").bind(projectId), db.prepare("DELETE FROM github_activity WHERE project_id=?").bind(projectId)]);
      return reply({ ok: true });
    }
    if (body.action === "member") {
      if (typeof body.account_id !== "string" || typeof body.allowed !== "boolean") return reply({ error: "Choose a project member." }, 400);
      if (!await db.prepare("SELECT id FROM accounts WHERE id=? AND enabled=1 AND role='member'").bind(body.account_id).first()) return reply({ error: "Member not found." }, 404);
      await db.prepare(body.allowed ? "INSERT OR IGNORE INTO github_project_members (project_id,account_id) VALUES (?,?)" : "DELETE FROM github_project_members WHERE project_id=? AND account_id=?").bind(projectId, body.account_id).run();
      return reply({ ok: true });
    }
    if (body.action === "refresh") {
      await db.prepare("UPDATE github_connections SET version=version+1 WHERE project_id=?").bind(projectId).run();
      return reply({ ok: true });
    }
    return reply({ error: "Unknown action." }, 400);
  } catch (error) {
    if (error instanceof GithubError) return reply({ error: error.message }, error.status >= 500 ? 502 : 400);
    if (error instanceof SyntaxError) return reply({ error: "Invalid JSON." }, 400);
    console.error("GitHub project request failed", error instanceof Error ? error.name : "Error");
    return reply({ error: "GitHub is unavailable. Check configuration and database migrations." }, 503);
  }
}

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
export function importantEvent(event: string, payload: ObjectValue): { kind: string; title: string; url: string } | null {
  const pr = object(payload.pull_request), run = object(payload.check_run || payload.check_suite || payload.workflow_run);
  const title = typeof pr.title === "string" ? pr.title.slice(0, 250) : "Pull request";
  if (event === "pull_request" && payload.action === "review_requested") return { kind: "review", title: `Review requested: #${pr.number} ${title}`, url: String(pr.html_url || "") };
  if (event === "pull_request" && payload.action === "closed" && pr.merged === true) return { kind: "merge", title: `Merged: #${pr.number} ${title}`, url: String(pr.html_url || "") };
  if (["check_run", "check_suite", "workflow_run"].includes(event) && payload.action === "completed" && ["failure", "timed_out", "action_required", "startup_failure"].includes(String(run.conclusion))) {
    return { kind: "failure", title: `Checks need attention: ${String(run.name || "CI").slice(0, 200)}`, url: String(run.html_url || "") };
  }
  if (event === "status" && ["failure", "error"].includes(String(payload.state))) return { kind: "failure", title: `Check failed: ${String(payload.context || "CI").slice(0, 200)}`, url: String(payload.target_url || "") };
  return null;
}
export async function githubWebhook(request: Request, db: D1Database, env: GithubEnvironment) {
  if (!env.GITHUB_WEBHOOK_SECRET) return reply({ error: "Webhook unavailable." }, 503);
  const raw = await readBody(request, 2_000_000);
  if (!raw) return reply({ error: "Payload too large." }, 413);
  if (!await verifyWebhook(env.GITHUB_WEBHOOK_SECRET, request.headers.get("x-hub-signature-256"), raw)) return reply({ error: "Invalid signature." }, 401);
  const delivery = request.headers.get("x-github-delivery"), event = request.headers.get("x-github-event") || "";
  if (!delivery || !/^[a-f\d-]{36}$/i.test(delivery)) return reply({ error: "Invalid delivery." }, 400);
  let payload: ObjectValue;
  try { payload = object(JSON.parse(new TextDecoder().decode(raw))); } catch { return reply({ error: "Invalid JSON." }, 400); }
  const installationId = Number(object(payload.installation).id), repoId = Number(object(payload.repository).id);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return reply({ ignored: true });
  const now = Date.now(), nonce = crypto.randomUUID();
  // Durable delivery ID + all event effects in one D1 transaction. Replays are harmless.
  const statements: D1PreparedStatement[] = [db.prepare("INSERT OR IGNORE INTO github_deliveries (id,nonce,created_at) VALUES (?,?,?)").bind(delivery, nonce, now)];
  const fresh = "EXISTS(SELECT 1 FROM github_deliveries WHERE id=? AND nonce=?)";
  // A previously committed delivery is explicitly rejected; D1 batch serializes the subsequent insertion/effects.
  if (await db.prepare("SELECT id FROM github_deliveries WHERE id=?").bind(delivery).first()) return reply({ duplicate: true });
  if (event === "installation" && ["deleted", "suspend"].includes(String(payload.action))) {
    statements.push(db.prepare(`UPDATE github_connections SET active=0,snapshot=NULL,last_error='GitHub App access revoked.',last_webhook=?,version=version+1 WHERE installation_id=? AND ${fresh}`).bind(now, installationId, delivery, nonce));
  } else if (event === "installation_repositories" && Array.isArray(payload.repositories_removed)) {
    const removedIds = payload.repositories_removed.map(removed => Number(object(removed).id)).filter(Number.isSafeInteger);
    statements.push(db.prepare(`UPDATE github_connections SET active=0,snapshot=NULL,last_error='Repository removed from the GitHub App.',last_webhook=?,version=version+1 WHERE installation_id=? AND repository_id IN (SELECT value FROM json_each(?)) AND ${fresh}`).bind(now, installationId, JSON.stringify(removedIds), delivery, nonce));
  } else if (Number.isSafeInteger(repoId) && repoId > 0) {
    if (event === "repository" && payload.action === "deleted") {
      statements.push(db.prepare(`UPDATE github_connections SET active=0,snapshot=NULL,last_error='Repository deleted.',last_webhook=?,version=version+1 WHERE installation_id=? AND repository_id=? AND ${fresh}`).bind(now, installationId, repoId, delivery, nonce));
    } else {
      statements.push(db.prepare(`UPDATE github_connections SET version=version+1,last_webhook=? WHERE installation_id=? AND repository_id=? AND active=1 AND ${fresh}`).bind(now, installationId, repoId, delivery, nonce));
      const activity = importantEvent(event, payload);
      if (activity) statements.push(db.prepare(`INSERT OR IGNORE INTO github_activity (id,project_id,generation,kind,title,url,created_at) SELECT ? || ':' || project_id,project_id,generation,?,?,?,? FROM github_connections WHERE repository_id=? AND installation_id=? AND active=1 AND ${fresh}`).bind(delivery, activity.kind, activity.title, activity.url, now, repoId, installationId, delivery, nonce));
    }
  }
  statements.push(db.prepare("DELETE FROM github_deliveries WHERE created_at<?").bind(now - 7 * 86400000));
  await db.batch(statements);
  return reply({ ok: true });
}
