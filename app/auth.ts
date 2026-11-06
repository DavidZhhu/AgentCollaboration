import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
const INVITE_DURATION = 48 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 600000;
const COOKIE = "ac_session";
export type Account = { id: string; username: string; role: string };
const encode = (bytes: Uint8Array) =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
const randomToken = () => encode(crypto.getRandomValues(new Uint8Array(32)));
export async function tokenHash(value: string) {
  return encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function username(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_.-]{2,31}$/i.test(value))
    throw new Error(
      "Use 3–32 letters, numbers, dots, underscores, or hyphens for the username.",
    );
  return value.toLowerCase();
}
function password(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw new Error("Choose a password between 12 and 128 characters.");
  return value;
}
async function passwordHash(value: string, salt = randomToken()) {
  const bytes = await pbkdf2Async(sha256, value, salt, {
    c: PASSWORD_ITERATIONS,
    dkLen: 32,
  });
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${salt}$${encode(bytes)}`;
}
async function verifyPassword(value: string, stored: string) {
  const [algorithm, count, salt] = stored.split("$");
  if (
    algorithm !== "pbkdf2-sha256" ||
    Number(count) !== PASSWORD_ITERATIONS ||
    !salt
  )
    return false;
  return equal(await passwordHash(value, salt), stored);
}
function cookie(
  request: Request,
  token: string,
  seconds = SESSION_DURATION / 1000,
) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`;
}
const reply = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
  });
function sessionToken(request: Request) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
}
export async function currentAccount(
  request: Request,
  db: D1Database,
): Promise<Account | null> {
  const token = sessionToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db
    .prepare(
      "SELECT accounts.id,accounts.username,accounts.role FROM sessions JOIN accounts ON accounts.id=sessions.account_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND accounts.enabled=1",
    )
    .bind(await tokenHash(token), Date.now())
    .first<Account>();
}
async function limit(db: D1Database, key: string, maximum: number) {
  const now = Date.now();
  const result: any = await db
    .prepare(
      "INSERT INTO auth_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count",
    )
    .bind(await tokenHash(key), now + 900000, now, now, now + 900000)
    .first();
  return result.count <= maximum;
}
async function loginSession(
  request: Request,
  db: D1Database,
  account: Account,
) {
  const token = randomToken();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(Date.now()),
    db
      .prepare(
        "INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)",
      )
      .bind(await tokenHash(token), account.id, Date.now() + SESSION_DURATION),
    db.prepare("DELETE FROM auth_limits WHERE expires_at<=?").bind(Date.now()),
  ]);
  return reply({ user: account }, 200, {
    "Set-Cookie": cookie(request, token),
  });
}
export async function auth(
  request: Request,
  db: D1Database,
  bootstrapSecret?: string,
) {
  try {
    if (request.method === "GET") {
      const account = await currentAccount(request, db);
      if (!account) return reply({ error: "Please sign in." }, 401);
      return reply({ user: account });
    }
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return reply({ error: "Cross-origin requests are not allowed." }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return reply({ error: "JSON required." }, 415);
    const raw = await request.text();
    if (raw.length > 4096) return reply({ error: "Request too large." }, 413);
    const body = JSON.parse(raw);
    const now = Date.now();
    if (
      ["login", "setup", "accept_invite", "inspect_invite"].includes(
        body.action,
      )
    ) {
      if (
        !(await limit(
          db,
          "ip:" + (request.headers.get("cf-connecting-ip") || "local"),
          100,
        ))
      )
        return reply(
          { error: "Too many attempts. Try again in 15 minutes." },
          429,
          { "Retry-After": "900" },
        );
    }
    if (body.action === "login") {
      const name = username(body.username);
      if (!(await limit(db, "login:" + name, 10)))
        return reply(
          { error: "Too many attempts. Try again in 15 minutes." },
          429,
          { "Retry-After": "900" },
        );
      const account: any = await db
        .prepare("SELECT * FROM accounts WHERE username=? AND enabled=1")
        .bind(name)
        .first();
      const candidate =
        typeof body.password === "string" && body.password.length <= 128
          ? body.password
          : "";
      // Perform the same expensive derivation when an account is missing.
      const stored =
        account?.password_hash ||
        `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${"0".repeat(64)}$${"0".repeat(64)}`;
      const valid = await verifyPassword(candidate, stored);
      if (!account?.password_hash || !valid)
        return reply({ error: "Username or password is incorrect." }, 401);
      return loginSession(request, db, {
        id: account.id,
        username: account.username,
        role: account.role,
      });
    }
    if (body.action === "setup") {
      if (
        !bootstrapSecret ||
        typeof body.token !== "string" ||
        !equal(await tokenHash(body.token), await tokenHash(bootstrapSecret))
      )
        return reply({ error: "This owner setup link is invalid." }, 403);
      const name = username(body.username);
      const hashed = await passwordHash(password(body.password));
      const account = {
        id: crypto.randomUUID(),
        username: name,
        role: "owner",
      };
      try {
        await db
          .prepare(
            "INSERT INTO accounts (id,username,role,owner_key,password_hash,enabled,created_at) VALUES (?,?,'owner','owner',?,1,?)",
          )
          .bind(account.id, name, hashed, now)
          .run();
      } catch {
        return reply(
          {
            error:
              "The owner account has already been created, or that username is taken.",
          },
          409,
        );
      }
      return loginSession(request, db, account);
    }
    if (body.action === "inspect_invite" || body.action === "accept_invite") {
      if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token))
        return reply({ error: "This invitation is invalid or expired." }, 410);
      const inviteHash = await tokenHash(body.token);
      const account: any = await db
        .prepare(
          "SELECT id,username,role FROM accounts WHERE invite_hash=? AND invite_expires>? AND enabled=1",
        )
        .bind(inviteHash, now)
        .first();
      if (!account)
        return reply({ error: "This invitation is invalid or expired." }, 410);
      if (body.action === "inspect_invite")
        return reply({ username: account.username });
      const hashed = await passwordHash(password(body.password));
      const updated = await db
        .prepare(
          "UPDATE accounts SET password_hash=?,invite_hash=NULL,invite_expires=NULL WHERE id=? AND invite_hash=? AND invite_expires>? AND enabled=1 RETURNING id",
        )
        .bind(hashed, account.id, inviteHash, Date.now())
        .first();
      if (!updated)
        return reply(
          { error: "This invitation has already been used or expired." },
          410,
        );
      await db
        .prepare("DELETE FROM sessions WHERE account_id=?")
        .bind(account.id)
        .run();
      return loginSession(request, db, account);
    }
    const account = await currentAccount(request, db);
    if (!account) return reply({ error: "Please sign in." }, 401);
    if (body.action === "logout") {
      const token = sessionToken(request);
      if (token)
        await db
          .prepare("DELETE FROM sessions WHERE token_hash=?")
          .bind(await tokenHash(token))
          .run();
      return reply({ ok: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
    }
    if (account.role !== "owner")
      return reply({ error: "Only the owner can manage accounts." }, 403);
    if (body.action === "members") {
      const members = await db
        .prepare(
          "SELECT id,username,role,enabled,created_at,password_hash IS NOT NULL AS activated, (SELECT role FROM agents WHERE account_id=accounts.id AND deleted_at IS NULL LIMIT 1) AS agent_role FROM accounts ORDER BY created_at",
        )
        .all();
      return reply({ members: members.results });
    }
    if (body.action === "create_invite") {
      const name = username(body.username);
      const token = randomToken();
      const accountId = crypto.randomUUID();
      const assignedAgent = typeof body.agent_id === "string" ? body.agent_id : "";
      if (!assignedAgent) return reply({ error: "Choose the teammate’s assigned agent role first." }, 400);
      const available = await db.prepare("SELECT agents.id FROM agents JOIN projects ON projects.id=agents.project_id WHERE agents.id=? AND agents.deleted_at IS NULL AND projects.deleted_at IS NULL AND agents.account_id IS NULL AND agents.worker_id IS NULL").bind(assignedAgent).first();
      if (!available) return reply({ error: "Choose an unassigned agent without a running worker." }, 409);
      try {
        await db.batch([
          db.prepare("INSERT INTO accounts (id,username,role,invite_hash,invite_expires,enabled,created_at) VALUES (?,?,'member',?,?,1,?)")
            .bind(accountId, name, await tokenHash(token), now + INVITE_DURATION, now),
          db.prepare("UPDATE agents SET account_id=? WHERE id=? AND account_id IS NULL AND worker_id IS NULL").bind(accountId, assignedAgent),
        ]);
        const assigned = await db.prepare("SELECT id FROM agents WHERE id=? AND account_id=?").bind(assignedAgent, accountId).first();
        if (!assigned) {
          await db.prepare("DELETE FROM accounts WHERE id=?").bind(accountId).run();
          return reply({error: "This role was just assigned to someone else. Choose another role."}, 409);
        }
      } catch {
        return reply({ error: "That username is already in use." }, 409);
      }
      return reply({
        username: name,
        invite_token: token,
        expires_at: now + INVITE_DURATION,
      });
    }
    if (body.action === "assign_role") {
      const assigned = await db.prepare("UPDATE agents SET account_id=? WHERE id=? AND account_id IS NULL AND worker_id IS NULL AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM accounts WHERE id=? AND role='member' AND enabled=1) AND EXISTS (SELECT 1 FROM projects WHERE projects.id=agents.project_id AND projects.deleted_at IS NULL) RETURNING id")
        .bind(body.account_id, body.agent_id, body.account_id).first();
      if (!assigned) return reply({error: "Choose an enabled teammate and an available agent without a running worker."}, 409);
      return reply({ok: true});
    }
    if (body.action === "reset_invite") {
      const token = randomToken();
      const updated: any = await db
        .prepare(
          "UPDATE accounts SET invite_hash=?,invite_expires=?,password_hash=NULL,enabled=1 WHERE id=? AND role='member' RETURNING username",
        )
        .bind(await tokenHash(token), now + INVITE_DURATION, body.account_id)
        .first();
      if (!updated) return reply({ error: "Member not found." }, 404);
      await db
        .prepare("DELETE FROM sessions WHERE account_id=?")
        .bind(body.account_id)
        .run();
      return reply({
        username: updated.username,
        invite_token: token,
        expires_at: now + INVITE_DURATION,
      });
    }
    if (body.action === "disable_member") {
      const updated = await db
        .prepare(
          "UPDATE accounts SET enabled=0,invite_hash=NULL,invite_expires=NULL WHERE id=? AND role='member' RETURNING id",
        )
        .bind(body.account_id)
        .first();
      if (!updated) return reply({ error: "Member not found." }, 404);
      await db
        .prepare("DELETE FROM sessions WHERE account_id=?")
        .bind(body.account_id)
        .run();
      return reply({ ok: true });
    }
    return reply({ error: "Unknown account action." }, 400);
  } catch (error) {
    return reply(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to complete this request.",
      },
      400,
    );
  }
}
