import type { SetupAgent, SetupGrant } from "./setup-types";
import { currentAccount, tokenHash } from "./auth";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
export async function setup(request: Request, db: D1Database, exchange = false) {
    try {
        const now = Date.now();
        if (request.method === "POST") {
            const origin = request.headers.get("origin");
            if (origin && origin !== new URL(request.url).origin)
                return json({ error: "Cross-origin writes are not allowed." }, 403);
            if (!request.headers.get("content-type")?.startsWith("application/json"))
                return json({ error: "JSON required." }, 415);
        }
        const raw = request.method === "POST" ? await request.text() : "{}";
        if (raw.length > 4096)
            return json({ error: "Request too large." }, 413);
        const body = JSON.parse(raw);
        if (exchange) {
            if (request.method !== "POST" || typeof body.code !== "string" || !/^[a-f0-9]{64}$/.test(body.code))
                return json({ error: "Invalid setup code." }, 400);
            const grant = await db.prepare("SELECT setup_grants.*,agents.project_id,projects.repo FROM setup_grants JOIN agents ON agents.id=setup_grants.agent_id JOIN projects ON projects.id=agents.project_id JOIN accounts ON accounts.id=agents.account_id WHERE setup_grants.code_hash=? AND setup_grants.expires_at>? AND agents.deleted_at IS NULL AND projects.deleted_at IS NULL AND accounts.enabled=1 AND (agents.worker_seen IS NULL OR agents.worker_seen<? OR agents.worker_id IS NULL)").bind(await tokenHash(body.code), now, now - 45000).first<SetupGrant>();
            if (!grant)
                return json({ error: "Setup code expired, was used, or a worker is already running. Generate a new command in the wizard." }, 410);
            const token = "ac_" + random();
            const results = await db.batch([
                db.prepare("UPDATE agents SET token_hash=?,provider=?,worker_id=NULL,worker_status='stopped',worker_error='' WHERE id=? AND EXISTS (SELECT 1 FROM setup_grants WHERE code_hash=? AND expires_at>?) AND (worker_seen IS NULL OR worker_seen<? OR worker_id IS NULL) RETURNING id").bind(await tokenHash(token), grant.provider, grant.agent_id, grant.code_hash, now, now - 45000),
                db.prepare("DELETE FROM setup_grants WHERE code_hash=? RETURNING code_hash").bind(grant.code_hash),
                db.prepare("DELETE FROM setup_checks WHERE agent_id=?").bind(grant.agent_id),
            ]);
            if (!results[0].results.length || !results[1].results.length)
                return json({ error: "This setup command was already used or a worker connected. Generate a new command." }, 410);
            return json({ token, provider: grant.provider === "Claude Code" ? "claude" : "codex", session_mode: grant.session_mode, session_id: grant.session_id, workspace: grant.folder, clone_repo: !!grant.clone_repo, repo: grant.repo });
        }
        const account = await currentAccount(request, db);
        if (!account)
            return json({ error: "Please sign in." }, 401);
        const assigned = await db.prepare("SELECT agents.id,agents.name,agents.role,agents.provider,agents.worker_seen,agents.worker_status,agents.worker_error,agents.worker_id,projects.name AS project_name,projects.repo FROM agents JOIN projects ON projects.id=agents.project_id WHERE agents.account_id=? AND agents.deleted_at IS NULL AND projects.deleted_at IS NULL").bind(account.id).all<SetupAgent>();
        if (request.method === "GET") {
            const checks = await db.prepare("SELECT setup_checks.* FROM setup_checks JOIN agents ON agents.id=setup_checks.agent_id WHERE agents.account_id=?").bind(account.id).all();
            return json({ agents: assigned.results, checks: checks.results, user: account.username, owner: account.role === "owner" });
        }
        const agent = assigned.results.find((item) => item.id === body.agent_id);
        if (!agent)
            return json({ error: "This role has not been assigned to your account. Ask the owner for an invitation with an assigned role." }, 403);
        if (body.action === "command") {
            if (agent.worker_id && (agent.worker_seen || 0) > now - 45000)
                return json({ error: "This role already has a running worker. Stop it on the other Mac before reconnecting, or continue to verification." }, 409);
            if (!["Codex", "Claude Code"].includes(body.provider))
                throw new Error("Choose Codex or Claude Code.");
            if (!["new", "existing"].includes(body.session_mode))
                throw new Error("Choose a session mode.");
            if (body.session_mode === "existing" && (typeof body.session_id !== "string" || !/^[a-f0-9-]{36}$/i.test(body.session_id)))
                throw new Error("Enter the local CLI conversation’s session UUID.");
            if (typeof body.folder !== "string" || !body.folder.trim() || body.folder.length > 1000 || !/^(~\/|\/)/.test(body.folder) || /[\x00-\x1f]/.test(body.folder))
                throw new Error("Enter an absolute Mac folder path or a path beginning with ~/.");
            if (body.clone_repo && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(agent.repo))
                throw new Error("The project needs an HTTPS GitHub repository URL. Ask the owner to update the repository setting.");
            const code = random();
            await db.batch([
                db.prepare("DELETE FROM setup_grants WHERE agent_id=? OR expires_at<=?").bind(agent.id, now),
                db.prepare("INSERT INTO setup_grants (code_hash,agent_id,provider,session_mode,session_id,folder,clone_repo,expires_at) VALUES (?,?,?,?,?,?,?,?)").bind(await tokenHash(code), agent.id, body.provider, body.session_mode, body.session_mode === "existing" ? body.session_id : "", body.folder.trim(), body.clone_repo ? 1 : 0, now + 1800000),
            ]);
            return json({ code, expires_at: now + 1800000 });
        }
        if (body.action === "test") {
            if (!agent.worker_id || (agent.worker_seen || 0) <= now - 45000)
                return json({ error: "Waiting for your Mac. Run the setup command first." }, 409);
            // Keep repeated clicks and network retries from replacing an in-flight challenge.
            await db.prepare("INSERT INTO setup_checks (agent_id,nonce,status,summary,created_at) VALUES (?,?,'pending','',?) ON CONFLICT(agent_id) DO UPDATE SET nonce=excluded.nonce,status='pending',summary='',created_at=excluded.created_at,completed_at=NULL WHERE setup_checks.status!='pending' OR setup_checks.created_at<=?")
                .bind(agent.id, random(), now, now - 600000).run();
            return json({ ok: true });
        }
        return json({ error: "Unknown setup action." }, 400);
    }
    catch (error) {
        return json({ error: error instanceof Error ? error.message : "Setup failed. Please retry." }, 400);
    }
}
