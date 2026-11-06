import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { setup } from '../app/setup-server.ts';
import { tokenHash } from '../app/auth.ts';
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
sqlite.prepare("INSERT INTO agents (id,project_id,name,role,provider,token_hash,created_at) VALUES ('current','p','Current PM','R0','Claude Code','old-unused',?)").run(now);
const ownerPage=await result(setup(req('/api/setup',undefined,ownerToken),db));
assert.ok(ownerPage.body.agents.some(a=>a.id==='current'));
assert.ok(!(await result(setup(req('/api/setup',undefined,memberToken),db))).body.agents.some(a=>a.id==='current'));
const currentBody={action:'command',agent_id:'current',provider:'Claude Code',session_mode:'current',folder:'~/Developer/project',clone_repo:false};
assert.equal((await setup(req('/api/setup',{...currentBody,clone_repo:true},ownerToken),db)).status,400);
const currentGrant=await result(setup(req('/api/setup',currentBody,ownerToken),db));
assert.equal(currentGrant.status,200);
assert.equal(sqlite.prepare("SELECT account_id FROM agents WHERE id='current'").get().account_id,'owner');
const currentExchange=await result(setup(req('/api/setup/exchange',{code:currentGrant.body.code}),db,true));
assert.equal(currentExchange.status,200);assert.equal(currentExchange.body.session_mode,'current');
const currentToken=currentExchange.body.token,currentId=crypto.randomUUID(),otherId=crypto.randomUUID();
const currentRequest=(body,id=currentId)=>req('/api/agent',body,'',{authorization:'Bearer '+currentToken,'x-agentcollab-worker':id});
assert.equal((await handle(currentRequest({action:'worker_heartbeat',mode:'session',label:'Claude Desktop · existing PM',status:'idle'}),db,true)).status,200);
let health=await result(handle(req('/api/agent?status=1',undefined,'',{authorization:'Bearer '+currentToken}),db,true));
assert.equal(health.body.connection_mode,'session');assert.equal(health.body.controller_label,'Claude Desktop · existing PM');
assert.equal((await handle(currentRequest({action:'worker_heartbeat',status:'idle'},otherId),db,true)).status,409);
assert.equal((await handle(req('/api/agent',undefined,'',{authorization:'Bearer '+currentToken}),db,true)).status,409);
assert.equal((await setup(req('/api/setup',currentBody,ownerToken),db)).status,409);
assert.equal((await setup(req('/api/setup',{action:'test',agent_id:'current'},ownerToken),db)).status,200);
const currentInbox=await result(handle(currentRequest(),db,true));
assert.ok(currentInbox.body.setup_check.nonce);
assert.equal(currentInbox.body.connection_mode,'session');
assert.equal((await handle(currentRequest({action:'setup_check_result',nonce:currentInbox.body.setup_check.nonce,summary:'Existing session returned this challenge'}),db,true)).status,200);
assert.equal((await handle(currentRequest({action:'worker_heartbeat',mode:'session',status:'stopped'}),db,true)).status,200);
assert.equal((await handle(currentRequest({action:'worker_heartbeat',status:'idle'},otherId),db,true)).status,200);
health=await result(handle(req('/api/agent?status=1',undefined,'',{authorization:'Bearer '+currentToken}),db,true));
assert.equal(health.body.connection_mode,'worker');
console.log('PASS: owner current-conversation setup, account scoping, single-controller handover, session status, and existing-session challenge delivery.');
