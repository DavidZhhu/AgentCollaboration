import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { setup } from '../app/setup-server.ts';
import { auth, tokenHash } from '../app/auth.ts';
import { handle } from '../app/server.ts';
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for (const name of readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort())
    sqlite.exec(readFileSync('drizzle/' + name, 'utf8'));
const db = {
    prepare(sql) {
        let values = [];
        return {
            bind(...args) { values = args; return this; },
            async first() { return sqlite.prepare(sql).get(...values) || null; },
            async all() { return { results: sqlite.prepare(sql).all(...values) }; },
            async run() { return sqlite.prepare(sql).run(...values); },
        };
    },
    async batch(statements) { sqlite.exec('BEGIN'); try {
        const results = [];
        for (const statement of statements)
            results.push(await statement.all());
        sqlite.exec('COMMIT');
        return results;
    }
    catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
    } },
};
const now = Date.now(), ownerToken = '1'.repeat(64), memberToken = '2'.repeat(64);
sqlite.prepare("INSERT INTO projects (id,name,repo,created_at) VALUES ('p','Team project','https://github.com/example/project.git',?)").run(now);
for (const [id, token] of [['owner', ownerToken], ['other', memberToken]]) {
    sqlite.prepare('INSERT INTO accounts (id,username,role,created_at) VALUES (?,?,?,?)').run(id, id, id === 'owner' ? 'owner' : 'member', now);
    sqlite.prepare('INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)').run(await tokenHash(token), id, now + 600000);
}
sqlite.prepare("INSERT INTO agents (id,project_id,name,role,provider,token_hash,created_at) VALUES ('a','p','Developer','R01','Codex','unused',?)").run(now);
function req(path, body, token = '', extra = {}) { return new Request('https://workspace.example' + path, { headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { cookie: 'ac_session=' + token } : {}), ...extra }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) }); }
async function result(response) { const r = await response; return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }; }
assert.equal((await setup(req('/api/setup'), db)).status, 401);
assert.equal((await result(auth(req('/api/auth', { action: 'create_invite', username: 'alice' }, ownerToken), db))).status, 400);
const invite = await result(auth(req('/api/auth', { action: 'create_invite', username: 'alice', agent_id: 'a' }, ownerToken), db));
assert.equal(invite.status, 200);
assert.equal((await result(auth(req('/api/auth', { action: 'create_invite', username: 'bob', agent_id: 'a' }, ownerToken), db))).status, 409);
const accept = await result(auth(req('/api/auth', { action: 'accept_invite', token: invite.body.invite_token, password: 'Synthetic password 2026!' }), db));
assert.equal(accept.status, 200);
assert.equal((await result(auth(req('/api/auth', { action: 'accept_invite', token: invite.body.invite_token, password: 'Synthetic password 2026!' }), db))).status, 410);
const alice = accept.cookie.split('=')[1];
const page = await result(setup(req('/api/setup', undefined, alice), db));
assert.equal(page.body.agents[0].role, 'R01');
assert.ok(!JSON.stringify(page.body).includes('token_hash'));
const commandBody = { action: 'command', agent_id: 'a', provider: 'Claude Code', session_mode: 'new', folder: '~/Developer/project', clone_repo: true };
assert.equal((await setup(req('/api/setup', commandBody, memberToken), db)).status, 403);
assert.equal((await setup(req('/api/setup', commandBody, alice, { origin: 'https://evil.example' }), db)).status, 403);
assert.equal((await setup(req('/api/setup', { ...commandBody, session_mode: 'existing', session_id: 'not-a-uuid' }, alice), db)).status, 400);
assert.equal((await setup(req('/api/setup', { ...commandBody, folder: 'relative/path' }, alice), db)).status, 400);
let grant = await result(setup(req('/api/setup', commandBody, alice), db));
assert.equal(grant.status, 200);
assert.equal(sqlite.prepare('SELECT code_hash FROM setup_grants').get().code_hash, await tokenHash(grant.body.code));
const replaced = grant.body.code;
grant = await result(setup(req('/api/setup', commandBody, alice), db));
assert.equal((await setup(req('/api/setup/exchange', { code: replaced }), db, true)).status, 410);
let exchange = await result(setup(req('/api/setup/exchange', { code: grant.body.code }), db, true));
assert.equal(exchange.status, 200);
assert.equal(exchange.body.provider, 'claude');
assert.equal((await setup(req('/api/setup/exchange', { code: grant.body.code }), db, true)).status, 410);
const token = exchange.body.token;
assert.equal(sqlite.prepare("SELECT token_hash FROM agents WHERE id='a'").get().token_hash, await tokenHash(token));
const workerId = crypto.randomUUID();
const agentReq = (body, id = workerId) => req('/api/agent', body, '', { authorization: 'Bearer ' + token, 'x-agentcollab-worker': id });
assert.equal((await handle(agentReq({ action: 'worker_heartbeat', status: 'idle' }), db, true)).status, 200);
assert.equal((await setup(req('/api/setup', commandBody, alice), db)).status, 409);
assert.equal((await setup(req('/api/setup', { action: 'test', agent_id: 'a' }, alice), db)).status, 200);
const inbox = await result(handle(agentReq(), db, true));
const nonce = inbox.body.setup_check.nonce;
assert.ok(nonce);
await setup(req('/api/setup', { action: 'test', agent_id: 'a' }, alice), db);
assert.equal(sqlite.prepare('SELECT nonce FROM setup_checks').get().nonce, nonce);
assert.equal((await handle(agentReq({ action: 'setup_check_result', nonce, summary: 'Test reply' }, crypto.randomUUID()), db, true)).status, 409);
assert.equal((await handle(agentReq({ action: 'setup_check_result', nonce: 'wrong', summary: 'Test reply' }), db, true)).status, 409);
assert.equal((await handle(agentReq({ action: 'setup_check_result', nonce, summary: 'Test reply' }), db, true)).status, 200);
assert.equal((await handle(agentReq({ action: 'setup_check_result', nonce, summary: 'Test reply' }), db, true)).status, 200);
assert.equal((await result(setup(req('/api/setup', undefined, alice), db))).body.checks[0].status, 'passed');
sqlite.prepare("UPDATE agents SET worker_seen=0 WHERE id='a'").run();
grant = await result(setup(req('/api/setup', commandBody, alice), db));
sqlite.prepare('UPDATE setup_grants SET expires_at=0').run();
assert.equal((await setup(req('/api/setup/exchange', { code: grant.body.code }), db, true)).status, 410);
grant = await result(setup(req('/api/setup', commandBody, alice), db));
exchange = await result(setup(req('/api/setup/exchange', { code: grant.body.code }), db, true));
assert.equal(exchange.status, 200);
assert.notEqual(exchange.body.token, token);
assert.equal((await handle(agentReq(), db, true)).status, 401);
assert.equal((await result(setup(req('/api/setup', undefined, alice), db))).body.checks.length, 0);
sqlite.prepare("UPDATE accounts SET enabled=0 WHERE username='alice'").run();
assert.equal((await handle(req('/api/agent', undefined, '', { authorization: 'Bearer ' + exchange.body.token }), db, true)).status, 401);
assert.equal((await setup(req('/api/setup', undefined, alice), db)).status, 401);
console.log('PASS: migrations, role-bound invitation redemption, authorization, provider and folder validation, single-use expiring setup grants, token rotation, worker conflict, round-trip test, retry idempotency, and disabled-account revocation.');

sqlite.prepare("INSERT INTO agents (id,project_id,name,role,provider,token_hash,created_at) VALUES ('b','p','Other developer','R02','Codex','unused',?)").run(now);
assert.equal((await auth(req('/api/auth',{action:'assign_role',account_id:'other',agent_id:'b'},memberToken),db)).status,403);
assert.equal((await auth(req('/api/auth',{action:'assign_role',account_id:'other',agent_id:'b'},ownerToken),db)).status,200);
assert.equal((await result(setup(req('/api/setup',undefined,memberToken),db))).body.agents[0].role,'R02');
console.log('PASS: owner can assign an available role to an existing member.');
