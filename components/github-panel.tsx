"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GitPullRequest, GitPullRequest as Github, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import type { GithubRepository, GithubView } from "../lib/github-types";
import "./github-panel.css";

type RepositoryOption = GithubRepository & { installation_id: number };
const failure = (value: string | null) => ["failure", "timed_out", "action_required", "startup_failure"].includes(value || "");
function safeLink(value: string | null) {
  try { const url = new URL(value || ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function Link({ url, children }: { url: string | null; children: React.ReactNode }) {
  const href = safeLink(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={12} aria-label="Opens in a new tab" /></a> : <span>{children}</span>;
}
export default function GithubPanel({ projectId, compact = false, onExpand }: { projectId: string; compact?: boolean; onExpand?: () => void }) {
  const [view, setView] = useState<GithubView | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<RepositoryOption[]>([]);
  const [limitedOptions, setLimitedOptions] = useState(false);
  const [selected, setSelected] = useState("");
  const [manualRepo, setManualRepo] = useState("");
  const [manualInstallation, setManualInstallation] = useState("");
  const requestId = useRef(0);
  const endpoint = `/api/github?project_id=${encodeURIComponent(projectId)}`;
  const read = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestId.current;
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const body = await response.json() as GithubView & { error?: string; repositories: RepositoryOption[]; limited: boolean };
      if (signal?.aborted || sequence !== requestId.current) return;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) setView(null);
        throw new Error(body.error || "GitHub information is unavailable.");
      }
      setView(body as GithubView);
      setError("");
    } catch (caught) {
      if (!signal?.aborted && sequence === requestId.current) setError(caught instanceof Error ? caught.message : "Could not load GitHub information.");
    }
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) await read(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [read]);
  async function act(body: Record<string, unknown>) {
    setSaving(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The change could not be saved.");
      await read();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The change could not be saved."); }
    finally { setSaving(false); }
  }
  async function loadRepositories() {
    setSaving(true); setError("");
    try {
      const response = await fetch(`${endpoint}&repositories=1`, { cache: "no-store" });
      const body = await response.json() as GithubView & { error?: string; repositories: RepositoryOption[]; limited: boolean };
      if (!response.ok) throw new Error(body.error || "Repositories could not be loaded.");
      setOptions(body.repositories); setLimitedOptions(body.limited);
      if (!body.repositories.length) setError("No repositories found. Install the GitHub App on a selected repository, then try again.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Repositories could not be loaded."); }
    finally { setSaving(false); }
  }
  const snapshot = view?.snapshot;
  const openPulls = snapshot?.pulls.filter(pull => pull.state === "open") || [];
  const latestRuns = [...new Map([...(snapshot?.runs || [])].reverse().map(run => [`${run.workflow_id}:${run.head_branch}`, run])).values()];
  const failedRuns = latestRuns.filter(run => failure(run.conclusion));
  const failedChecks = snapshot?.checks.filter(check => failure(check.conclusion)) || [];
  const failedStatuses = snapshot?.statuses.filter(status => ["failure", "error"].includes(status.state)) || [];
  return <section className="gh-panel panel" aria-label="Project GitHub information">
    <header className="gh-heading"><div><span className="gh-eyebrow"><Github size={14} /> DEVELOPMENT</span><h2>GitHub progress</h2></div>
      {compact ? <button className="secondary" onClick={onExpand}>View GitHub <ExternalLink size={13} /></button> : view?.owner && view.connected ? <button className="secondary" disabled={saving} onClick={() => void act({ action: "refresh" })}><RefreshCw size={14} />Refresh</button> : null}
    </header>
    {error && <p className="gh-error" role="alert">{error}{view?.snapshot && " Displayed information may be out of date."}</p>}
    {!view && !error && <p className="gh-muted" role="status">Loading GitHub information…</p>}
    {view && !view.configured && <p className="gh-notice">GitHub live sync is not configured yet. The owner must install a read-only GitHub App and configure its webhook. <a href="https://github.com/DavidZhhu/AgentCollaboration/blob/main/docs/github-integration.md" target="_blank" rel="noreferrer">Setup instructions</a></p>}
    {view?.connected && <div className="gh-connection"><strong>{view.connection?.full_name}</strong><span>Read only · {snapshot?.repository.private ? "Private" : snapshot ? "Public" : "Awaiting sync"}</span>
      <span>{view.connection?.last_sync ? `Synced ${new Date(view.connection.last_sync).toLocaleTimeString()}` : "Waiting for first sync"}{view.connection?.pending ? " · Update pending" : ""}</span>
      <span>{view.connection?.last_webhook ? `Webhook received ${new Date(view.connection.last_webhook).toLocaleString()}` : "No webhook received yet"}</span>
    </div>}
    {view?.connection?.last_error && <p className="gh-error" role="status">{view.connection.last_error} {snapshot && "The last successful snapshot is shown."}</p>}
    {snapshot && <>
      <div className="gh-metrics"><div><strong>{openPulls.length}</strong><span>Open PRs</span></div><div><strong>{openPulls.filter(p => p.requested_reviewers.length || p.requested_teams?.length).length}</strong><span>Awaiting review</span></div><div><strong>{failedRuns.length + failedChecks.length + failedStatuses.length}</strong><span>Failure signals</span></div></div>
      {!!snapshot.limited.length && <p className="gh-notice">Showing recent information. More available on GitHub: {snapshot.limited.join(", ")}.</p>}
      <div className="gh-columns"><div><h3><GitPullRequest size={15} />Pull requests</h3>
        {!openPulls.length && <p className="gh-muted">No open pull requests in the synced window.</p>}
        <ul className="gh-items">{openPulls.slice(0, compact ? 4 : 100).map(pull => <li key={pull.number}><Link url={pull.html_url}>#{pull.number} {pull.title}</Link><small>{pull.draft ? "Draft" : "Open"} · {pull.head.ref}{pull.requested_reviewers.length || pull.requested_teams?.length ? ` · Review: ${[...pull.requested_reviewers.map(r => r.login), ...(pull.requested_teams || []).map(t => t.slug)].join(", ")}` : ""}</small></li>)}</ul>
      </div><div><h3>Needs attention</h3>
        {!failedRuns.length && !failedChecks.length && !failedStatuses.length && <p className="gh-muted">No failed checks in the synced window.</p>}
        <ul className="gh-items">{failedRuns.slice(0, compact ? 3 : 20).map(run => <li key={`run-${run.id}`}><Link url={run.html_url}>{run.name}</Link><small>{run.conclusion} · {run.head_sha.slice(0, 7)}</small></li>)}
          {failedChecks.slice(0, compact ? 2 : 20).map(check => <li key={`check-${check.id}`}><Link url={check.html_url}>{check.name}</Link><small>{check.conclusion} · {check.head_sha.slice(0, 7)}</small></li>)}
          {failedStatuses.slice(0, compact ? 2 : 20).map(status => <li key={`${status.sha}:${status.context}`}><Link url={status.target_url}>{status.context}</Link><small>{status.state} · {status.sha.slice(0, 7)}</small></li>)}
        </ul>
      </div></div>
      <div className="gh-feed"><h3>Project activity</h3><p className="gh-muted">Review requests, failed checks, and merges. Agent conversations stay in Conversations.</p>
        {!view.activities?.length && <p className="gh-muted">Important GitHub events will appear here after the webhook is connected.</p>}
        <ul className="gh-items">{view.activities?.slice(0, compact ? 5 : 50).map(activity => <li key={activity.id}><Link url={activity.url}>{activity.title}</Link><small>{new Date(activity.created_at).toLocaleString()}</small></li>)}</ul>
      </div>
      {!compact && <details className="gh-details"><summary>Repository details and recent development</summary>
        <p>{snapshot.repository.description}</p><Link url={snapshot.repository.html_url}>Open repository</Link>
        <h3>README</h3><pre className="gh-readme">{snapshot.readme || "No README found."}</pre>
        <h3>Issues</h3><ul className="gh-items">{snapshot.issues.map(issue => <li key={issue.number}><Link url={issue.html_url}>#{issue.number} {issue.title}</Link><small>{issue.state}</small></li>)}</ul>
        <h3>Branches</h3><ul className="gh-items">{snapshot.branches.map(branch => <li key={branch.name}>{branch.name}<small>{branch.commit.sha.slice(0, 7)}{branch.protected ? " · Protected" : ""}</small></li>)}</ul>
        <h3>Recent commits</h3><ul className="gh-items">{snapshot.commits.map(commit => <li key={commit.sha}><Link url={commit.html_url}>{commit.commit.message.split("\n")[0]}</Link><small>{commit.sha.slice(0, 7)}</small></li>)}</ul>
        <h3>Recent pull requests</h3><ul className="gh-items">{snapshot.pulls.map(pull => <li key={pull.number}><Link url={pull.html_url}>#{pull.number} {pull.title}</Link><small>{pull.merged_at ? "Merged" : pull.state}</small></li>)}</ul>
        <h3>Workflow runs</h3><ul className="gh-items">{latestRuns.map(run => <li key={run.id}><Link url={run.html_url}>{run.name}</Link><small>{run.conclusion || run.status} · {run.head_sha.slice(0, 7)}</small></li>)}</ul>
      </details>}
    </>}
    {view && !view.connected && <p className="gh-muted">No GitHub repository is connected to this project.{!view.owner && " Ask the project owner to connect one."}</p>}
    {!compact && view?.owner && <details className="gh-details" open={!view.connected}><summary>Repository connection and authorized viewers</summary>
      <p className="gh-notice"><ShieldCheck size={14} /> Only explicitly authorized accounts can view this project’s synced GitHub information. The owner always has access. The PM changes GitHub directly.</p>
      {view.configured && <><button className="secondary" disabled={saving} onClick={() => void loadRepositories()}>Choose an installed repository</button>
        {!!options.length && <form className="gh-connect" onSubmit={event => { event.preventDefault(); const repo = options.find(item => `${item.installation_id}:${item.id}` === selected); if (repo) void act({ action: "connect", full_name: repo.full_name, installation_id: repo.installation_id }); }}>
          <label htmlFor={`gh-repo-${projectId}`}>Repository</label><select id={`gh-repo-${projectId}`} required value={selected} onChange={event => setSelected(event.target.value)}><option value="">Select repository…</option>{options.map(repo => <option key={`${repo.installation_id}:${repo.id}`} value={`${repo.installation_id}:${repo.id}`}>{repo.full_name}{repo.private ? " (private)" : " (public)"}</option>)}</select><button className="primary" disabled={saving || !selected}>Connect selected repository</button>
        </form>}
        {limitedOptions && <p className="gh-muted">The repository list is limited. Use the installation ID and owner/name below if yours is not listed.</p>}
        <details><summary>Connect using installation ID</summary><form className="gh-connect" onSubmit={event => { event.preventDefault(); void act({ action: "connect", installation_id: Number(manualInstallation), full_name: manualRepo.trim() }); }}><label>Installation ID<input type="number" min="1" required value={manualInstallation} onChange={event => setManualInstallation(event.target.value)} /></label><label>Repository (owner/name)<input required value={manualRepo} onChange={event => setManualRepo(event.target.value)} placeholder="your-team/your-project" /></label><button className="primary" disabled={saving}>Verify and connect</button></form></details>
      </>}
      <h3>Authorized viewers</h3><p className="gh-muted">Manage team accounts in Team accounts, then grant access here.</p>
      <div className="gh-members">{view.members?.map(member => <label key={member.id}><input type="checkbox" checked={!!member.allowed} disabled={saving} onChange={event => void act({ action: "member", account_id: member.id, allowed: event.target.checked })} />{member.username}</label>)}</div>
      {view.connected && <button className="secondary" disabled={saving} onClick={() => void act({ action: "disconnect" })}>Disconnect repository</button>}
    </details>}
    <p className="gh-footnote">GitHub is read only here. Task cards and acceptance remain independent of GitHub merges. Updates usually appear within seconds while this page is open.</p>
  </section>;
}
