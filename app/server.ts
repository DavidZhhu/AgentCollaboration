const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const id = () => crypto.randomUUID();
const createAgentToken = () =>
  "ac_" +
  crypto.randomUUID().replaceAll("-", "") +
  crypto.randomUUID().replaceAll("-", "");
const isPm = (agent: any) =>
  agent.role === "R0" || agent.role === "Product manager";
async function hash(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function required(value: unknown, name: string, max = 10000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`Enter ${name} (up to ${max} characters).`);
  return value.trim();
}
export async function handle(
  request: Request,
  db: D1Database,
  agentOnly = false,
  account?: { id: string; username: string },
) {
  try {
    let agent: any = null;
    const user =
      account?.id || request.headers.get("oai-authenticated-user-id");
    if (agentOnly) {
      const token = request.headers
        .get("authorization")
        ?.replace(/^Bearer /, "");
      if (!token) return json({ error: "Agent token required." }, 401);
      agent = await db
        .prepare(
          "SELECT * FROM agents WHERE token_hash=? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM projects WHERE projects.id=agents.project_id AND projects.deleted_at IS NULL) AND (account_id IS NULL OR EXISTS (SELECT 1 FROM accounts WHERE accounts.id=agents.account_id AND accounts.enabled=1))",
        )
        .bind(await hash(token))
        .first();
      if (!agent)
        return json({ error: "Invalid or revoked agent token." }, 401);
    } else if (!user)
      return json({ error: "Sign in to your private workspace." }, 401);
    if (!agentOnly && request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin)
        return json({ error: "Cross-origin writes are not allowed." }, 403);
    }
    const now = Date.now();
    if (
      agent &&
      request.method === "GET" &&
      new URL(request.url).searchParams.get("status") === "1"
    ) {
      return json({
        agent: {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          provider: agent.provider,
        },
        worker_status: agent.worker_status,
        worker_seen: agent.worker_seen,
        worker_error: agent.worker_error,
        worker_online: !!agent.worker_id && agent.worker_seen > now - 45000,
      });
    }
    const workerId = request.headers.get("x-agentcollab-worker");
    const body: any = request.method === "GET" ? null : await request.json();
    if (agent && body?.action === "worker_heartbeat") {
      if (!workerId || !/^[a-f0-9-]{36}$/.test(workerId))
        return json({ error: "A valid worker identity is required." }, 400);
      if (!["idle", "running", "error", "stopped"].includes(body.status))
        return json({ error: "Invalid worker status." }, 400);
      const result = await db
        .prepare(
          "UPDATE agents SET worker_id=?,worker_seen=?,worker_status=?,worker_error=? WHERE id=? AND (worker_id=? OR worker_seen IS NULL OR worker_seen<? OR worker_id IS NULL) RETURNING id",
        )
        .bind(
          body.status === "stopped" ? null : workerId,
          now,
          body.status,
          typeof body.error === "string" ? body.error.slice(0, 500) : "",
          agent.id,
          workerId,
          now - 45000,
        )
        .first();
      if (!result)
        return json(
          { error: "Another worker currently controls this agent." },
          409,
        );
      return json({ ok: true });
    }
    if (
      agent?.worker_id &&
      agent.worker_seen > now - 45000 &&
      agent.worker_id !== workerId
    )
      return json(
        { error: "A background worker currently controls this agent." },
        409,
      );
    if (agent && body?.action === "setup_check_result") {
      if (!workerId || agent.worker_id !== workerId || agent.worker_seen <= now - 45000)
        return json({ error: "An active worker lease is required." }, 409);
      const summary = typeof body.summary === "string" ? body.summary.slice(0, 2000) : "";
      const check = await db.prepare("UPDATE setup_checks SET status='passed',summary=?,completed_at=? WHERE agent_id=? AND nonce=? AND status IN ('pending','passed') AND created_at>? RETURNING agent_id")
        .bind(summary, now, agent.id, body.nonce, now - 600000).first();
      if (!check) return json({ error: "This connection test expired or was replaced. Retry in the wizard." }, 409);
      return json({ ok: true });
    }
    let operationKey: string | null = null;
    let requestHash: string | null = null;
    if (agent && request.method !== "GET") {
      const requestId = request.headers.get("x-agentcollab-request-id");
      if (requestId) {
        if (!/^[a-f0-9-]{36}$/.test(requestId))
          return json({ error: "Invalid request identity." }, 400);
        operationKey = await hash(agent.id + ":" + requestId);
        requestHash = await hash(JSON.stringify(body));
        const receipt: any = await db
          .prepare(
            "SELECT request_hash FROM worker_receipts WHERE id=? AND agent_id=?",
          )
          .bind(operationKey, agent.id)
          .first();
        if (receipt)
          return receipt.request_hash === requestHash
            ? json({ ok: true, replayed: true })
            : json(
                {
                  error:
                    "This request identity was already used for different content.",
                },
                409,
              );
      }
    }
    const mutationId = operationKey || id();
    if (request.method === "GET") {
      if (agent) {
        await db
          .prepare("UPDATE agents SET last_seen=? WHERE id=?")
          .bind(now, agent.id)
          .run();
        const active = await db
          .prepare(
            "SELECT * FROM cards WHERE agent_id=? AND status='working' ORDER BY created_at LIMIT 1",
          )
          .bind(agent.id)
          .first();
        const next = active
          ? null
          : await db
              .prepare(
                "SELECT * FROM cards WHERE agent_id=? AND status='queued' ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at LIMIT 1",
              )
              .bind(agent.id)
              .first();
        const url = new URL(request.url);
        const after = Number(url.searchParams.get("after") || 0);
        const afterId = url.searchParams.get("after_id") || "";
        const preciseCursor = url.searchParams.has("after_id") ? 1 : 0;
        const msgs = await db
          .prepare(
            "SELECT * FROM messages WHERE project_id=? AND (created_at>? OR (?=1 AND created_at=? AND id>?)) AND (channel='general' OR channel=?) ORDER BY created_at,id LIMIT 100",
          )
          .bind(
            agent.project_id,
            Number.isFinite(after) ? after : 0,
            preciseCursor,
            Number.isFinite(after) ? after : 0,
            afterId,
            agent.id,
          )
          .all();
        const project = await db
          .prepare("SELECT id,name,direction,repo FROM projects WHERE id=?")
          .bind(agent.project_id)
          .first();
        let team = null;
        if (isPm(agent)) {
          const results = await db.batch([
            db
              .prepare(
                "SELECT id,name,role,provider,responsibility,last_seen,status,worker_seen,worker_status,worker_error FROM agents WHERE project_id=? AND deleted_at IS NULL",
              )
              .bind(agent.project_id),
            db
              .prepare(
                "SELECT * FROM cards WHERE project_id=? ORDER BY created_at",
              )
              .bind(agent.project_id),
            db
              .prepare(
                "SELECT * FROM decisions WHERE project_id=? ORDER BY created_at",
              )
              .bind(agent.project_id),
          ]);
          team = {
            agents: results[0].results,
            cards: results[1].results,
            decisions: results[2].results,
          };
        }
        return json({
          agent: {
            id: agent.id,
            name: agent.name,
            role: agent.role === "Product manager" ? "R0" : agent.role,
            responsibility: agent.responsibility || "",
          },
          project,
          active_card: active,
          next_card: next,
          messages: msgs.results,
          team,
          setup_check: await db.prepare("SELECT nonce,created_at FROM setup_checks WHERE agent_id=? AND status='pending' AND created_at>?").bind(agent.id, now - 600000).first(),
          setup_verified: !!(await db.prepare("SELECT agent_id FROM setup_checks WHERE agent_id=? AND status='passed'").bind(agent.id).first()),
          server_time: now,
        });
      }
      const projects = await db
        .prepare(
          "SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at",
        )
        .all();
      const agents = await db
        .prepare(
          "SELECT id,project_id,name,role,provider,responsibility,account_id,status,last_seen,worker_id,worker_seen,worker_status,worker_error,created_at FROM agents WHERE deleted_at IS NULL ORDER BY created_at",
        )
        .all();
      const deletedProjects = await db
        .prepare(
          "SELECT id,name FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
        )
        .all();
      const deletedAgents = await db
        .prepare(
          "SELECT id,project_id,name,role FROM agents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
        )
        .all();
      const cards = await db
        .prepare("SELECT * FROM cards ORDER BY created_at DESC")
        .all();
      const messages = await db
        .prepare(
          "SELECT * FROM (SELECT * FROM messages ORDER BY created_at DESC LIMIT 500) ORDER BY created_at",
        )
        .all();
      const decisions = await db
        .prepare("SELECT * FROM decisions ORDER BY created_at DESC")
        .all();
      return json({
        projects: projects.results,
        deleted_projects: deletedProjects.results,
        deleted_agents: deletedAgents.results,
        agents: agents.results,
        cards: cards.results,
        messages: messages.results,
        decisions: decisions.results,
        user:
          account?.username ||
          request.headers.get("oai-authenticated-user-full-name") ||
          request.headers.get("oai-authenticated-user-email") ||
          "You",
      });
    }
    const projectId =
      agent?.project_id || required(body.project_id, "a project", 100);
    if (
      !(await db
        .prepare("SELECT id FROM projects WHERE id=? AND deleted_at IS NULL")
        .bind(projectId)
        .first()) &&
      !["project", "restore_project"].includes(body.action)
    )
      return json({ error: "Project not found." }, 404);
    const author =
      agent?.name ||
      account?.username ||
      request.headers.get("oai-authenticated-user-email") ||
      "Project owner";
    const authorType = agent ? "agent" : "human";
    const message = (text: string, channel = "general") =>
      db
        .prepare(
          "INSERT OR IGNORE INTO messages (id,project_id,author,author_type,channel,body,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(mutationId, projectId, author, authorType, channel, text, now);
    if (agent)
      await db
        .prepare("UPDATE agents SET last_seen=? WHERE id=?")
        .bind(now, agent.id)
        .run();
    switch (body.action) {
      case "delete_project":
      case "restore_project": {
        if (agent) return json({ error: "Human access required." }, 403);
        const restoring = body.action === "restore_project";
        const result = await db
          .prepare(
            `UPDATE projects SET deleted_at=? WHERE id=? AND deleted_at IS ${restoring ? "NOT NULL" : "NULL"} RETURNING id`,
          )
          .bind(restoring ? null : now, projectId)
          .first();
        if (!result)
          return json({ error: "Project not found or already updated." }, 404);
        break;
      }
      case "delete_agent":
      case "restore_agent": {
        if (agent) return json({ error: "Human access required." }, 403);
        const restoring = body.action === "restore_agent";
        const agentId = required(body.agent_id, "an agent", 100);
        if (restoring) {
          const archived: any = await db
            .prepare("SELECT role FROM agents WHERE id=? AND project_id=?")
            .bind(agentId, projectId)
            .first();
          if (
            archived &&
            (await db
              .prepare(
                "SELECT id FROM agents WHERE project_id=? AND deleted_at IS NULL AND (role=? OR (? IN ('R0','Product manager') AND role IN ('R0','Product manager')))",
              )
              .bind(projectId, archived.role, archived.role)
              .first())
          )
            return json(
              { error: "Another active agent already has this role." },
              409,
            );
        }
        const result = await db
          .prepare(
            `UPDATE agents SET deleted_at=? WHERE id=? AND project_id=? AND deleted_at IS ${restoring ? "NOT NULL" : "NULL"} RETURNING id`,
          )
          .bind(restoring ? null : now, agentId, projectId)
          .first();
        if (!result)
          return json({ error: "Agent not found or already updated." }, 404);
        break;
      }

      case "update_project": {
        if (agent) return json({ error: "Human access required." }, 403);
        const name = required(body.name, "a project name", 100);
        const description = body.description ?? "";
        const repo = body.repo ?? "";
        if (typeof description !== "string" || description.length > 5000)
          throw new Error("Enter a description up to 5000 characters.");
        if (typeof repo !== "string" || repo.length > 500)
          throw new Error("Enter a GitHub repository URL up to 500 characters.");
        const repository = repo.trim();
        if (repository && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(repository))
          throw new Error("Use a GitHub repository URL such as https://github.com/owner/repository.");
        await db.prepare("UPDATE projects SET name=?,description=?,repo=? WHERE id=? AND deleted_at IS NULL")
          .bind(name, description.trim(), repository, projectId).run();
        break;
      }
      case "project": {
        if (agent) return json({ error: "Human access required." }, 403);
        const name = required(body.name, "a project name", 100);
        await db
          .prepare(
            "INSERT INTO projects (id,name,direction,repo,created_at) VALUES (?,?,?,?,?)",
          )
          .bind(projectId, name, body.direction || "", body.repo || "", now)
          .run();
        break;
      }
      case "reset_agent_token": {
        if (agent) return json({ error: "Human access required." }, 403);
        const agentId = required(body.agent_id, "an agent", 100);
        const token = createAgentToken();
        const updated = await db
          .prepare(
            "UPDATE agents SET token_hash=?,worker_id=NULL,worker_seen=NULL,worker_status='stopped',worker_error='',last_seen=NULL WHERE id=? AND project_id=? AND deleted_at IS NULL RETURNING id",
          )
          .bind(await hash(token), agentId, projectId)
          .first();
        if (!updated)
          return json({ error: "Agent connection not found." }, 404);
        return json({ ok: true, agent_id: agentId, token });
      }
      case "agent": {
        if (agent) return json({ error: "Human access required." }, 403);
        const token = createAgentToken();
        const agentId = id();
        const provider = required(body.provider, "a provider", 30);
        if (!["Codex", "Claude Code"].includes(provider))
          throw new Error("Choose Codex or Claude Code.");
        const role = required(body.role, "a role code", 12).toUpperCase();
        if (!/^R(?:0|[0-9]{2,})$/.test(role))
          throw new Error(
            "Use R0 for the PM, or a role code such as R01 or R02.",
          );
        const responsibility =
          typeof body.responsibility === "string"
            ? body.responsibility.trim().slice(0, 2000)
            : "";
        const created = await db
          .prepare(
            "INSERT INTO agents (id,project_id,name,role,provider,responsibility,token_hash,status,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM agents WHERE project_id=? AND deleted_at IS NULL AND (role=? OR (?='R0' AND role='Product manager'))) RETURNING id",
          )
          .bind(
            agentId,
            projectId,
            required(body.name, "a name", 100),
            role,
            provider,
            responsibility,
            await hash(token),
            "idle",
            now,
            projectId,
            role,
            role,
          )
          .first();
        if (!created)
          return json(
            {
              error:
                "That role already has an agent. Choose a different code or delete the existing connection.",
            },
            409,
          );
        return json({ ok: true, agent_id: agentId, token });
      }
      case "card": {
        if (agent && !isPm(agent))
          return json(
            { error: "Only the PM or a human can assign cards." },
            403,
          );
        if (
          !(await db
            .prepare(
              "SELECT id FROM agents WHERE id=? AND project_id=? AND deleted_at IS NULL",
            )
            .bind(body.agent_id, projectId)
            .first())
        )
          throw new Error("Choose an agent in this project.");
        if (!["high", "medium", "low"].includes(body.priority))
          throw new Error("Choose a priority.");
        await db
          .prepare(
            "INSERT OR IGNORE INTO cards (id,project_id,title,description,criteria,agent_id,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            mutationId,
            projectId,
            required(body.title, "a title", 180),
            required(body.description, "the scope"),
            required(body.criteria, "acceptance criteria"),
            body.agent_id,
            "queued",
            body.priority,
            now,
            now,
          )
          .run();
        break;
      }
      case "claim": {
        if (!agent) throw new Error("Use an agent session to claim work.");
        const result = await db
          .prepare(
            "UPDATE cards SET status='working',updated_at=? WHERE id=? AND agent_id=? AND status='queued' AND NOT EXISTS (SELECT 1 FROM cards WHERE agent_id=? AND status='working') RETURNING id",
          )
          .bind(now, body.card_id, agent.id, agent.id)
          .first();
        if (!result) {
          const existing = operationKey
            ? await db
                .prepare(
                  "SELECT id FROM cards WHERE id=? AND agent_id=? AND status='working'",
                )
                .bind(body.card_id, agent.id)
                .first()
            : null;
          if (!existing)
            return json(
              {
                error:
                  "Card unavailable or this agent already has an active card.",
              },
              409,
            );
        }
        await db
          .prepare("UPDATE agents SET status='working',last_seen=? WHERE id=?")
          .bind(now, agent.id)
          .run();
        break;
      }
      case "report": {
        if (!agent)
          throw new Error("Use the assigned agent to submit a report.");
        const report = {
          summary: required(body.report?.summary, "a summary"),
          changes: required(
            body.report?.changes,
            "changed files or deliverables",
          ),
          checks: required(body.report?.checks, "acceptance checks"),
          pr: typeof body.report?.pr === "string" ? body.report.pr : "",
          blockers:
            typeof body.report?.blockers === "string"
              ? body.report.blockers
              : "",
        };
        const result = await db
          .prepare(
            "UPDATE cards SET status='review',report=?,updated_at=? WHERE id=? AND agent_id=? AND status='working' RETURNING id",
          )
          .bind(JSON.stringify(report), now, body.card_id, agent.id)
          .first();
        if (!result) {
          const existing = operationKey
            ? await db
                .prepare(
                  "SELECT id FROM cards WHERE id=? AND agent_id=? AND status IN ('review','accepted') AND report=?",
                )
                .bind(body.card_id, agent.id, JSON.stringify(report))
                .first()
            : null;
          if (!existing)
            return json(
              { error: "This agent has no active claim on that card." },
              409,
            );
        }
        await db
          .prepare("UPDATE agents SET status='idle' WHERE id=?")
          .bind(agent.id)
          .run();
        break;
      }
      case "review": {
        if (agent && !isPm(agent))
          return json({ error: "PM access required." }, 403);
        if (!["accepted", "queued"].includes(body.status))
          throw new Error("Choose accept or request revisions.");
        const note = required(body.note, "review feedback");
        const result = await db
          .prepare(
            "UPDATE cards SET status=?,updated_at=? WHERE id=? AND project_id=? AND status='review' RETURNING id",
          )
          .bind(body.status, now, body.card_id, projectId)
          .first();
        if (!result) {
          const existing = operationKey
            ? await db
                .prepare(
                  "SELECT id FROM cards WHERE id=? AND project_id=? AND status=?",
                )
                .bind(body.card_id, projectId, body.status)
                .first()
            : null;
          if (!existing)
            return json(
              { error: "Only cards awaiting review can be reviewed." },
              409,
            );
        }
        await message(
          `Review · ${body.status === "accepted" ? "Accepted" : "Revisions requested"} · ${note}`,
        ).run();
        break;
      }
      case "message": {
        const channel = body.channel || "general";
        if (
          channel !== "general" &&
          !(await db
            .prepare(
              "SELECT id FROM agents WHERE id=? AND project_id=? AND deleted_at IS NULL",
            )
            .bind(channel, projectId)
            .first())
        )
          throw new Error("Conversation not found.");
        await message(required(body.body, "a message"), channel).run();
        break;
      }
      case "decision": {
        if (agent && !isPm(agent))
          return json({ error: "PM access required." }, 403);
        await db
          .prepare(
            "INSERT OR IGNORE INTO decisions (id,project_id,title,rationale,status,created_at) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            mutationId,
            projectId,
            required(body.title, "a proposed direction", 500),
            required(body.rationale, "the reason"),
            "pending",
            now,
          )
          .run();
        break;
      }
      case "approve": {
        if (
          operationKey &&
          (await db
            .prepare("SELECT id FROM messages WHERE id=? AND project_id=?")
            .bind(mutationId, projectId)
            .first())
        )
          break;
        let approvalAuthor = author;
        let reply = body.reply;
        let sourceMessageId = null;
        if (agent) {
          if (!isPm(agent) || !body.message_id)
            return json(
              {
                error:
                  "Human approval required. The PM must reference a human chat reply.",
              },
              403,
            );
          const source: any = await db
            .prepare(
              "SELECT * FROM messages WHERE id=? AND project_id=? AND author_type='human' AND (channel='general' OR channel=?)",
            )
            .bind(body.message_id, projectId, agent.id)
            .first();
          if (!source)
            return json(
              { error: "A human approval message is required." },
              403,
            );
          if (
            !/^(yes|approved|approve|go ahead|proceed|let['’]s do it|sounds good)\b/i.test(
              source.body.trim(),
            ) ||
            source.body.includes("?")
          )
            return json(
              { error: "Ask the human for an unambiguous approval reply." },
              403,
            );
          approvalAuthor = source.author;
          reply = source.body;
          sourceMessageId = source.id;
        }
        const decision: any = await db
          .prepare(
            "SELECT * FROM decisions WHERE id=? AND project_id=? AND status='pending'",
          )
          .bind(body.decision_id, projectId)
          .first();
        if (!decision)
          return json(
            { error: "This decision has already been resolved." },
            409,
          );
        if (sourceMessageId) {
          const source: any = await db
            .prepare("SELECT created_at FROM messages WHERE id=?")
            .bind(sourceMessageId)
            .first();
          if (source.created_at < decision.created_at)
            return json({ error: "Approval must follow the proposal." }, 403);
        }
        reply = required(reply, "your approval reply");
        const approval = JSON.stringify({
          by: approvalAuthor,
          reply,
          at: now,
          message_id: sourceMessageId,
          operation: id(),
        });
        const results = await db.batch([
          db
            .prepare(
              "UPDATE decisions SET status='approved',approval=? WHERE id=? AND status='pending' RETURNING id",
            )
            .bind(approval, decision.id),
          db
            .prepare(
              "UPDATE projects SET direction=? WHERE id=? AND EXISTS (SELECT 1 FROM decisions WHERE id=? AND approval=?)",
            )
            .bind(decision.title, projectId, decision.id, approval),
          db
            .prepare(
              "INSERT INTO messages (id,project_id,author,author_type,channel,body,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM decisions WHERE id=? AND approval=?)",
            )
            .bind(
              mutationId,
              projectId,
              author,
              authorType,
              "general",
              `Approved direction · ${decision.title}\n${reply}`,
              now,
              decision.id,
              approval,
            ),
        ]);
        if (!results[0].results.length)
          return json(
            { error: "This decision has already been resolved." },
            409,
          );
        break;
      }
      default:
        return json({ error: "Unknown action." }, 400);
    }
    if (operationKey && requestHash)
      await db
        .prepare(
          "INSERT OR IGNORE INTO worker_receipts (id,agent_id,request_hash,created_at) VALUES (?,?,?,?)",
        )
        .bind(operationKey, agent.id, requestHash, now)
        .run();
    return json({ ok: true });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to complete request.",
      },
      400,
    );
  }
}
