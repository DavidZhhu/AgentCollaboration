import type { GithubBranch, GithubCheck, GithubCommit, GithubIssue, GithubPull, GithubRepository, GithubRun, GithubSnapshot, GithubStatus } from "./github-types";

export interface GithubEnvironment {
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
}
export class GithubError extends Error {
  constructor(message: string, public status = 502, public retryAt = Date.now() + 60000) { super(message); }
}
export const configured = (env: GithubEnvironment) => !!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_WEBHOOK_SECRET);
const encode = (value: Uint8Array | string) => btoa(typeof value === "string" ? value : String.fromCharCode(...value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

// GitHub issues PKCS#1 RSA keys; Web Crypto imports PKCS#8.
function der(tag: number, value: Uint8Array): Uint8Array<ArrayBuffer> {
  const length = value.length;
  const bytes: number[] = [];
  for (let n = length; n; n >>>= 8) bytes.unshift(n & 255);
  return new Uint8Array([tag, ...(length < 128 ? [length] : [128 + bytes.length, ...bytes]), ...value]);
}
export async function appJwt(env: GithubEnvironment): Promise<string> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) throw new GithubError("The owner needs to configure the GitHub App.", 503);
  const pem = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  let bytes = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), c => c.charCodeAt(0));
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    bytes = der(0x30, new Uint8Array([2, 1, 0, 0x30, 0x0d, 6, 9, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 1, 1, 1, 5, 0, ...der(4, bytes)]));
  }
  const key = await crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }))}`;
  return `${payload}.${encode(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(payload))))}`;
}
export async function githubRequest<T>(token: string, path: string, options?: { method: "POST"; body: unknown }): Promise<{ data: T; more: boolean }> {
  // Only fixed API paths chosen by server code are accepted. Never follow provider URLs with credentials.
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) throw new GithubError("Invalid GitHub request.");
  const response = await fetch(`https://api.github.com${path}`, {
    method: options?.method || "GET", redirect: "error", signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "AgentCollaboration", ...(options ? { "Content-Type": "application/json" } : {}) },
    body: options ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const retry = Number(response.headers.get("retry-after"));
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    const retryAt = Math.max(Date.now() + (retry > 0 ? retry * 1000 : 60000), Number.isFinite(reset) ? reset : 0);
    const rateLimited = response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || retry > 0));
    throw new GithubError(rateLimited ? "GitHub rate limit reached. Sync will resume after the retry window." : response.status === 404 || response.status === 403 || response.status === 401 ? "GitHub access is unavailable. Check the App installation and selected repository permissions." : "GitHub could not complete the sync. Please retry later.", rateLimited ? 429 : response.status, retryAt);
  }
  return { data: await response.json() as T, more: /rel="next"/.test(response.headers.get("link") || "") };
}
export async function installationToken(env: GithubEnvironment, installationId: number, repositoryId?: number): Promise<string> {
  if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new GithubError("Invalid installation.", 400);
  const result = await githubRequest<{ token: string }>(await appJwt(env), `/app/installations/${installationId}/access_tokens`, { method: "POST", body: {
    ...(repositoryId ? { repository_ids: [repositoryId] } : {}),
    permissions: { metadata: "read", contents: "read", pull_requests: "read", issues: "read", checks: "read", actions: "read" },
  } });
  return result.data.token;
}
export async function selectedRepository(env: GithubEnvironment, installationId: number, fullName: string) {
  if (!/^[a-z\d](?:[a-z\d-]{0,38}[a-z\d])?\/[a-z\d_.-]{1,100}$/i.test(fullName) || [".", ".."].includes(fullName.split("/")[1])) throw new GithubError("Choose a repository in owner/name format.", 400);
  const token = await installationToken(env, installationId);
  const result = await githubRequest<GithubRepository>(token, `/repos/${fullName}`);
  return result.data;
}
export async function repositoryOptions(env: GithubEnvironment) {
  const installations = await githubRequest<{ id: number }[]>(await appJwt(env), "/app/installations?per_page=100");
  const repositories: (GithubRepository & { installation_id: number })[] = [];
  let limited = installations.more;
  // Bound work per request. A manually entered installed repo can also be verified server-side.
  for (const installation of installations.data.slice(0, 10)) {
    const result = await githubRequest<{ repositories: GithubRepository[] }>(await installationToken(env, installation.id), "/installation/repositories?per_page=100");
    repositories.push(...result.data.repositories.map(repo => ({ ...repo, installation_id: installation.id })));
    limited ||= result.more;
  }
  return { repositories, limited: limited || installations.data.length > 10 };
}
export async function snapshot(env: GithubEnvironment, installationId: number, repositoryId: number): Promise<GithubSnapshot> {
  const token = await installationToken(env, installationId, repositoryId);
  const repo = (await githubRequest<GithubRepository>(token, `/repositories/${repositoryId}`)).data;
  const base = `/repos/${repo.full_name}`;
  const limited: string[] = [];
  async function list<T>(path: string, category: string): Promise<T[]> {
    const result = await githubRequest<T[]>(token, `${base}${path}${path.includes("?") ? "&" : "?"}per_page=100`);
    if (result.more) limited.push(category);
    return result.data;
  }
  const [pulls, issues, branches, commits, runs, readme] = await Promise.all([
    Promise.all([list<GithubPull>("/pulls?state=open&sort=updated&direction=desc", "open pull requests"), list<GithubPull>("/pulls?state=closed&sort=updated&direction=desc", "closed pull requests")]).then(([open, closed]) => [...open, ...closed]),
    list<GithubIssue>("/issues?state=all&sort=updated&direction=desc", "issues"),
    list<GithubBranch>("/branches", "branches"),
    list<GithubCommit>("/commits", "commits").catch(error => { if (error instanceof GithubError && error.status === 409) return []; throw error; }),
    githubRequest<{ workflow_runs: GithubRun[] }>(token, `${base}/actions/runs?per_page=100`).then(result => { if (result.more) limited.push("workflow runs"); return result.data.workflow_runs; }),
    githubRequest<{ content: string; encoding: string }>(token, `${base}/readme`).then(result => result.data.encoding === "base64" ? new TextDecoder().decode(Uint8Array.from(atob(result.data.content.replace(/\s/g, "")), c => c.charCodeAt(0))).slice(0, 100000) : "").catch(error => { if (error instanceof GithubError && error.status === 404) return ""; throw error; }),
  ]);
  const heads = [...new Set([...pulls.filter(p => p.state === "open").map(p => p.head.sha), ...(commits[0] ? [commits[0].sha] : [])])];
  if (heads.length > 20) limited.push("PR check details (20 heads)");
  const checks: GithubCheck[] = [], statuses: GithubStatus[] = [];
  // At most six concurrent GitHub requests, respecting Worker connection limits.
  for (let offset = 0; offset < Math.min(heads.length, 20); offset += 3) {
    await Promise.all(heads.slice(offset, Math.min(offset + 3, 20)).map(async sha => {
    const [checkResult, statusResult] = await Promise.all([
      githubRequest<{ check_runs: GithubCheck[] }>(token, `${base}/commits/${sha}/check-runs?per_page=100`),
      githubRequest<{ statuses: GithubStatus[] }>(token, `${base}/commits/${sha}/status?per_page=100`),
    ]);
    checks.push(...checkResult.data.check_runs);
    statuses.push(...statusResult.data.statuses.map(status => ({ ...status, sha })));
    if (checkResult.more || statusResult.more) limited.push(`checks for ${sha.slice(0, 7)}`);
    }));
  }
  // Persist only the fields used by the viewer, not full provider payloads or credentials.
  return {
    repository: { id: repo.id, full_name: repo.full_name, private: repo.private, html_url: repo.html_url, description: repo.description, default_branch: repo.default_branch },
    pulls: [...new Map(pulls.map(pull => [pull.number, pull])).values()].map(pull => ({ number: pull.number, title: pull.title, html_url: pull.html_url, state: pull.state, draft: pull.draft, merged_at: pull.merged_at, updated_at: pull.updated_at, head: { sha: pull.head.sha, ref: pull.head.ref }, requested_reviewers: pull.requested_reviewers.map(reviewer => ({ login: reviewer.login })), requested_teams: (pull.requested_teams || []).map(team => ({ slug: team.slug })) })),
    issues: issues.filter(issue => !issue.pull_request).map(issue => ({ number: issue.number, title: issue.title, html_url: issue.html_url, state: issue.state, updated_at: issue.updated_at })),
    branches: branches.map(branch => ({ name: branch.name, commit: { sha: branch.commit.sha }, protected: branch.protected })),
    commits: commits.map(commit => ({ sha: commit.sha, html_url: commit.html_url, commit: { message: commit.commit.message.slice(0, 10000), author: commit.commit.author ? { date: commit.commit.author.date } : null } })),
    runs: runs.map(run => ({ id: run.id, workflow_id: run.workflow_id, head_branch: run.head_branch, name: run.name, html_url: run.html_url, status: run.status, conclusion: run.conclusion, head_sha: run.head_sha, updated_at: run.updated_at })),
    checks: checks.map(check => ({ id: check.id, name: check.name, html_url: check.html_url, status: check.status, conclusion: check.conclusion, head_sha: check.head_sha })),
    statuses: statuses.map(status => ({ context: status.context, state: status.state, target_url: status.target_url, sha: status.sha })),
    readme, limited,
  };
}

export async function verifyWebhook(secret: string, signature: string | null, raw: Uint8Array): Promise<boolean> {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature || "")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const digest = Uint8Array.from(signature!.slice(7).match(/../g)!, part => parseInt(part, 16));
  return crypto.subtle.verify("HMAC", key, digest, raw as Uint8Array<ArrayBuffer>);
}
