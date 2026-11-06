"use client";
import { useEffect, useState, useRef } from "react";
import {
  Layers,
  LayoutDashboard,
  Columns3,
  MessageSquare,
  Bot,
  ArrowUpRight,
  Plus,
  ChevronDown,
  ArrowRight,
  X,
  LockKeyhole,
  Radio,
  Check,
  Copy,
  GitPullRequest as Github,
  CircleHelp,
  Send,
  Circle,
  CheckCircle2,
  Clock3,
  Activity,
  Flag,
  Settings2,
  Terminal,
  Search,
  KeyRound,
  LogOut,
  Trash2,
  RotateCcw,
} from "lucide-react";
import "./workspace.css";
import Link from "next/link";
import { readApiResponse } from "./api-response";
import GithubPanel from "../components/github-panel";
const empty = {
  projects: [],
  deleted_projects: [],
  deleted_agents: [],
  agents: [],
  cards: [],
  messages: [],
  decisions: [],
  user: "You",
};
const short = (id: string) => id.slice(0, 6).toUpperCase();
function nextRoleCode(agents: any[]) {
  if (
    !agents.some(
      (agent) => agent.role === "R0" || agent.role === "Product manager",
    )
  )
    return "R0";
  const numbers = agents
    .filter((agent) => /^R[0-9]{2,}$/.test(agent.role))
    .map((agent) => Number(agent.role.slice(1)));
  return `R${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
}
const elapsed = (time: number) =>
  !time
    ? "Never connected"
    : Date.now() - time < 60000
      ? "Just now"
      : `${Math.floor((Date.now() - time) / 60000)}m ago`;
export default function Home() {
  const [data, setData] = useState<any>(empty),
    [projectId, setProjectId] = useState(""),
    [tab, setTab] = useState("Overview"),
    [modal, setModal] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [channel, setChannel] = useState("general"),
    [text, setText] = useState(""),
    [token, setToken] = useState(""),
    [copied, setCopied] = useState(false),
    [query, setQuery] = useState(""),
    [members, setMembers] = useState<any[]>([]),
    [inviteLink, setInviteLink] = useState("");
  const end = useRef<HTMLDivElement>(null);
  async function refresh() {
    try {
      const r = await fetch("/api/workspace");
      const d: any = await readApiResponse(r);
      if (r.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!r.ok) throw new Error(d.error);
      setData(d);
      setProjectId((p) =>
        d.projects.some((project: any) => project.id === p)
          ? p
          : d.projects[0]?.id || "",
      );
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);
  const project = data.projects.find((p: any) => p.id === projectId),
    agents = data.agents.filter((a: any) => a.project_id === projectId),
    cards = data.cards.filter(
      (c: any) =>
        c.project_id === projectId &&
        (!query ||
          `${c.title} ${c.description}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    ),
    messages = data.messages.filter(
      (m: any) => m.project_id === projectId && m.channel === channel,
    ),
    decisions = data.decisions.filter((d: any) => d.project_id === projectId),
    pending = decisions.filter((d: any) => d.status === "pending");
  const active = cards.filter((c: any) => c.status === "working").length,
    done = cards.filter((c: any) => c.status === "accepted").length;
  useEffect(() => {
    const container = end.current?.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages.length, channel]);
  async function act(body: any) {
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, ...body }),
      });
      const d: any = await readApiResponse(r);
      if (!r.ok) throw new Error(d.error);
      await refresh();
      return d;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setSaving(false);
    }
  }
  function open(name: string, item: any = null) {
    setError("");
    setSelected(item);
    setToken("");
    setInviteLink("");
    setModal(name);
    if (name === "access" && data.account_role === "owner") loadMembers();
  }
  async function accountAction(body: any) {
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result: any = await readApiResponse(response);
    if (!response.ok) throw new Error(result.error);
    return result;
  }
  async function loadMembers() {
    try {
      const result = await accountAction({ action: "members" });
      setMembers(result.members);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function memberAction(body: any) {
    setSaving(true);
    setError("");
    try {
      const result = await accountAction(body);
      if (result.invite_token)
        setInviteLink(
          `${window.location.origin}/login#invite=${result.invite_token}`,
        );
      await loadMembers();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function logout() {
    try {
      await accountAction({ action: "logout" });
      window.location.replace("/login");
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (modal === "project") {
        const pid = crypto.randomUUID();
        await act({ action: "project", project_id: pid, ...f });
        setProjectId(pid);
      } else if (modal === "agent") {
        const d = await act({ action: "agent", ...f });
        setToken(d.token);
        setSelected({ id: d.agent_id, name: f.name, provider: f.provider });
        setModal("connect");
        return;
      } else if (modal === "task") await act({ action: "card", ...f });
      else if (modal === "direction") await act({ action: "decision", ...f });
      else if (modal === "approve")
        await act({ action: "approve", decision_id: selected.id, ...f });
      setModal("");
    } catch {}
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await act({ action: "message", channel, body: text });
      setText("");
    } catch {}
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard unavailable. Select and copy the text.");
    }
  }
  const prompt = `You are ${selected?.name || "an agent"} in AgentCollaboration. Keep your assigned role and existing session. Use ${typeof window !== "undefined" ? window.location.origin : ""}/api/agent with Authorization: Bearer <YOUR_AGENT_TOKEN> to read your inbox. GET returns next_card, active_card and messages. POST {action:"claim",card_id:"..."} before starting a card. Complete only one card at a time. POST {action:"report",card_id:"...",report:{summary:"...",changes:"...",checks:"...",pr:"...",blockers:"..."}} when ready for PM review. POST {action:"message",channel:"general",body:"..."} to communicate. Check the inbox again after reporting and while waiting. Use bounded waiting commands and continue checking their output. If the app pauses or closes, queued work remains assigned to you. R0 is the PM. Other role codes have the responsibilities assigned by the owner. PM agents may also assign cards, propose decisions and review reports through this API. To record a clear human chat approval, POST {action:"approve",decision_id:"...",message_id:"..."}; the referenced message must be a real affirmative human reply sent after the proposal. Website acceptance does not merge GitHub PRs; use your local GitHub tools to merge after review.`;
  function cardView(c: any) {
    const a = [...agents, ...(data.deleted_agents || [])].find(
      (a: any) => a.id === c.agent_id,
    );
    return (
      <button className="task" key={c.id} onClick={() => open("detail", c)}>
        <div className="task-meta">
          <span>TC-{short(c.id)}</span>
          <span className={"priority " + c.priority}>{c.priority}</span>
        </div>
        <h3>{c.title}</h3>
        <p>{c.description}</p>
        <div className="task-footer">
          <span
            className={
              "avatar " + (a?.provider === "Claude Code" ? "amber" : "violet")
            }
          >
            {a?.name.slice(0, 1) || "?"}
          </span>
          <span>{a?.name || "Unassigned"}</span>
          <ArrowUpRight size={14} />
        </div>
      </button>
    );
  }
  const chat = (
    <section className="panel chat-panel">
      <div className="panel-head">
        <div>
          <h2>
            Team conversation <span className="live-dot" />
          </h2>
          <p>A shared space for decisions and questions.</p>
        </div>
        <MessageSquare size={18} />
      </div>
      <div className="channel-bar">
        <button
          className={channel === "general" ? "chosen" : ""}
          onClick={() => setChannel("general")}
        >
          # general
        </button>
        <select
          aria-label="Choose an agent conversation"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          <option value="general">All agents</option>
          {agents.map((a: any) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="messages">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <MessageSquare size={24} />
            <strong>Start the conversation</strong>
            <span>Ask the PM a question or share a project update.</span>
          </div>
        ) : (
          messages.map((m: any) => (
            <div className="message" key={m.id}>
              <span
                className={
                  "avatar " + (m.author_type === "agent" ? "violet" : "green")
                }
              >
                {m.author.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <div className="message-author">
                  {m.author}
                  <span>{m.author_type === "agent" ? "Agent" : "Human"}</span>
                  <time>
                    {new Date(m.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <p>{m.body}</p>
              </div>
            </div>
          ))
        )}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={send}>
        <input
          aria-label="Message"
          placeholder={
            channel === "general"
              ? "Message the team…"
              : "Message this conversation…"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!project}
        />
        <button
          className="send"
          aria-label="Send message"
          disabled={saving || !text.trim()}
        >
          <Send size={16} />
        </button>
      </form>
      <div className="chat-note">
        Visible to project members · Clear approvals can be recorded by the PM
      </div>
    </section>
  );
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="AgentCollaboration">
          <span>
            <Layers size={22} />
          </span>
          agent<span className="brand-light">collab</span>
          <sup>β</sup>
        </a>
        <div className="workspace-label">
          WORKSPACE <LockKeyhole size={11} />
        </div>
        <button className="project-switch" onClick={() => open("switch")}>
          <span className="project-icon">
            {project?.name?.slice(0, 1) || "A"}
          </span>
          <span>
            {project?.name || "Your workspace"}
            <small>Private project</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">PROJECT</div>
        <nav>
          {[
            [LayoutDashboard, "Overview"],
            [Columns3, "Task board"],
            [MessageSquare, "Conversations"],
            [Bot, "Agents"],
          ].map(([Icon, label]: any) => (
            <button
              key={label}
              className={tab === label ? "active" : ""}
              onClick={() => setTab(label)}
            >
              <Icon size={18} />
              {label}
              {label === "Task board" && cards.length > 0 && (
                <span className="nav-count">{cards.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-line" />
        <Link className="subnav" href="/help"><CircleHelp size={17} /> User guide <ArrowUpRight size={13} /></Link>
        <div className="nav-label">CONNECTIONS</div>
        <button className="subnav" onClick={() => setTab("GitHub")}>
          <Github size={17} />
          GitHub
          <ArrowUpRight size={13} />
        </button>
        <button className="subnav" onClick={() => open("help")}>
          <Terminal size={17} />
          Agent API
          <ArrowUpRight size={13} />
        </button>
        <div className="sidebar-bottom">
          <div className="private-card">
            <LockKeyhole size={16} />
            <div>
              <strong>Private by default</strong>
              <p>Only you and people you invite.</p>
              <button onClick={() => open("access")}>
                Manage access <ArrowRight size={12} />
              </button>
            </div>
          </div>
          <div className="profile">
            <span className="avatar green">Y</span>
            <div>
              <strong>{data.user || "Your workspace"}</strong>
              <small>
                {data.account_role === "owner"
                  ? "Workspace owner"
                  : "Team member"}
              </small>
            </div>
            <button
              aria-label="Workspace settings"
              onClick={() => open("access")}
            >
              <Settings2 size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span>Workspace</span>
            <span>/</span>
            <strong>{project?.name || "AgentCollaboration"}</strong>
          </div>
          <div className="top-actions">
            <span className="private-pill">
              <LockKeyhole size={12} />
              Private
            </span>
            <Link className="icon-button" href="/help" aria-label="Help and user guide"><CircleHelp size={18} /></Link>
            <Link className="secondary" href="/setup"><Terminal size={15} /> Connect conversation</Link>
            <button
              className="icon-button"
              aria-label="Team accounts"
              onClick={() => open("access")}
            >
              <Settings2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
            <span className="avatar green">
              {data.user?.slice(0, 1).toUpperCase() || "Y"}
            </span>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="live-dot" /> YOUR TEAM, IN SYNC
              </div>
              <h1>
                {tab === "GitHub" ? "GitHub progress" : tab === "Overview"
                  ? "Project overview"
                  : tab === "Task board"
                    ? "Task board"
                    : tab === "Agents"
                      ? "Your agents"
                      : "Conversations"}
              </h1>
              <p>
                {tab === "GitHub" ? "Development activity, review requests, and checks for this project." : tab === "Overview"
                  ? "One place to see what’s moving, what’s next, and what needs you."
                  : tab === "Task board"
                    ? "From a clear brief to reviewed work. Every task has an owner."
                    : tab === "Agents"
                      ? "Fixed roles. Existing sessions. Connected across computers."
                      : "Keep your agents and humans in the same conversation."}
              </p>
            </div>
            <div className="heading-actions">
              <button className="secondary" onClick={() => open("trash")}>
                <RotateCcw size={14} />
                Recently deleted
              </button>
              {project && (
                <button
                  className="delete-icon"
                  aria-label="Delete project"
                  title="Delete project"
                  onClick={() => open("delete-project", project)}
                >
                  <Trash2 size={17} />
                </button>
              )}
              <button
                className="primary"
                onClick={() => open(project ? "task" : "project")}
              >
                <Plus size={16} />
                {project ? "New task card" : "Create project"}
              </button>
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              {error.includes("Sign in") && (
                <a href="/login" target="_top">
                  Sign in
                </a>
              )}
            </div>
          )}
          {loading ? (
            <div className="loading">Connecting to your workspace…</div>
          ) : !project ? (
            <section className="welcome panel">
              <span className="welcome-icon">
                <Layers size={30} />
              </span>
              <div className="eyebrow">LET’S BUILD TOGETHER</div>
              <h2>A home for your agent team.</h2>
              <p>
                Create your first project, connect your PM and worker agents,
                and give every task a clear path to completion.
              </p>
              <button className="primary" onClick={() => open("project")}>
                <Plus size={16} />
                Create your first project
              </button>
              <div className="welcome-steps">
                <span>
                  01 <strong>Set a direction</strong>
                </span>
                <span>
                  02 <strong>Connect your agents</strong>
                </span>
                <span>
                  03 <strong>Let work flow</strong>
                </span>
              </div>
            </section>
          ) : (
            <>
              {(tab === "Overview" || tab === "GitHub") && <GithubPanel key={`${projectId}:${tab}`} projectId={projectId} compact={tab === "Overview"} onExpand={() => setTab("GitHub")} />}
              {tab === "Overview" && (
                <>
                  <div className="stats">
                    {[
                      [
                        Columns3,
                        "Total task cards",
                        cards.length,
                        "Across the project",
                      ],
                      [
                        Activity,
                        "In progress",
                        active,
                        "Agents building right now",
                      ],
                      [CheckCircle2, "Accepted", done, "Reviewed by your PM"],
                      [
                        Flag,
                        "Needs your input",
                        pending.length,
                        "Development decisions",
                      ],
                    ].map(([Icon, label, value, note]: any) => (
                      <div className="stat" key={label}>
                        <div>
                          <span>{label}</span>
                          <Icon size={17} />
                        </div>
                        <strong>{value.toString().padStart(2, "0")}</strong>
                        <small>{note}</small>
                      </div>
                    ))}
                  </div>
                  <section className="direction">
                    <span className="direction-icon">
                      <Flag size={20} />
                    </span>
                    <div>
                      <div className="eyebrow">CURRENT DIRECTION</div>
                      <h3>
                        {project.direction ||
                          "Define the next chapter with your PM"}
                      </h3>
                      <p>
                        {project.direction
                          ? "Your PM can assign work within this agreed direction."
                          : "Discuss the goal in chat, then record your agreed development direction."}
                      </p>
                    </div>
                    <button onClick={() => open("direction")}>
                      {project.direction ? "Propose change" : "Set direction"}
                      <ArrowRight size={15} />
                    </button>
                  </section>
                  {pending.length > 0 && (
                    <div className="decision-list">
                      {pending.map((d: any) => (
                        <button key={d.id} onClick={() => open("approve", d)}>
                          <Flag size={16} />
                          <span>
                            <strong>{d.title}</strong>
                            <small>{d.rationale}</small>
                          </span>
                          <span className="badge amber">Needs approval</span>
                          <ArrowRight size={16} />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {(tab === "Overview" || tab === "Task board") && (
                <section className="board-section">
                  <div className="section-head">
                    <div>
                      <h2>
                        Task cards <span className="count">{cards.length}</span>
                      </h2>
                      {tab === "Overview" && (
                        <p>Every agent knows what to work on next.</p>
                      )}
                    </div>
                    <div className="section-actions">
                      {tab === "Task board" && (
                        <div className="search">
                          <Search size={14} />
                          <input
                            placeholder="Search cards…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                      )}
                      {tab === "Overview" && (
                        <button onClick={() => setTab("Task board")}>
                          View board <ArrowUpRight size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="board">
                    {[
                      ["queued", "Queued"],
                      ["working", "In progress"],
                      ["review", "PM review"],
                      ["accepted", "Accepted"],
                    ].map(([status, label]) => (
                      <div className={"column " + status} key={status}>
                        <div className="column-head">
                          <span className="status-dot" />
                          <strong>{label}</strong>
                          <span>
                            {
                              cards.filter((c: any) => c.status === status)
                                .length
                            }
                          </span>
                          <button
                            aria-label={"Add " + label + " task"}
                            onClick={() => open("task")}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <div className="card-list">
                          {cards
                            .filter((c: any) => c.status === status)
                            .map(cardView)}
                          {!cards.some((c: any) => c.status === status) && (
                            <div className="empty-column">
                              {status === "queued"
                                ? "Ready for the next brief"
                                : status === "working"
                                  ? "Work starts here"
                                  : status === "review"
                                    ? "Reports arrive here"
                                    : "Completed, reviewed work"}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {(tab === "Overview" ||
                tab === "Conversations" ||
                tab === "Agents") && (
                <div className={tab === "Overview" ? "bottom-grid" : ""}>
                  {tab !== "Agents" && chat}
                  {tab !== "Conversations" && (
                    <section className="panel agents-panel">
                      <div className="panel-head">
                        <div>
                          <h2>
                            Connected agents{" "}
                            <span className="count">{agents.length}</span>
                          </h2>
                          <p>A clear role for every session.</p>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="Connect an agent"
                          onClick={() => open("agent")}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                      <div className="agent-list">
                        {agents.length === 0 ? (
                          <div className="empty-agents">
                            <Bot size={28} />
                            <strong>Your team starts here</strong>
                            <p>
                              Connect a PM, then add your specialist agents.
                            </p>
                            <button
                              className="secondary"
                              onClick={() => open("agent")}
                            >
                              <Plus size={14} />
                              Connect an agent
                            </button>
                          </div>
                        ) : (
                          agents.map((a: any) => {
                            const workerOnline =
                              a.worker_id &&
                              a.worker_seen &&
                              Date.now() - a.worker_seen < 45000;
                            const online =
                              workerOnline ||
                              (a.last_seen && Date.now() - a.last_seen < 45000);
                            const workerProblem =
                              workerOnline && a.worker_status === "error";
                            const working = cards.some(
                              (c: any) =>
                                c.agent_id === a.id && c.status === "working",
                            );
                            return (
                              <div className="agent-row" key={a.id}>
                                <span
                                  className={
                                    "agent-avatar " +
                                    (a.provider === "Claude Code"
                                      ? "amber"
                                      : "violet")
                                  }
                                >
                                  <Bot size={21} />
                                </span>
                                <div>
                                  <strong>{a.name}</strong>
                                  <span>
                                    {a.role === "Product manager"
                                      ? "R0"
                                      : a.role}{" "}
                                    · {a.provider}
                                  </span>
                                  <small>
                                    {a.responsibility ||
                                      elapsed(a.worker_seen || a.last_seen)}
                                  </small>
                                  {workerProblem && (
                                    <small className="worker-error">
                                      {a.worker_error}
                                    </small>
                                  )}
                                </div>
                                <span
                                  className={
                                    "agent-status " +
                                    (workerProblem
                                      ? "needs-attention"
                                      : online
                                        ? "online"
                                        : "offline")
                                  }
                                >
                                  <i />
                                  {workerProblem
                                    ? "Needs attention"
                                    : workerOnline
                                      ? a.connection_mode === "session"
                                        ? a.worker_status === "running" ? "Session active" : "Session watching"
                                        : a.worker_status === "running" ? "Working" : "Worker ready"
                                      : online
                                        ? working
                                          ? "Working"
                                          : "Manual session"
                                        : "Offline"}
                                </span>
                                <Link className="icon-button" href={`/setup?agent=${a.id}`} aria-label={`Connect current conversation to ${a.name}`} title="Connect current conversation"><MessageSquare size={16}/></Link>
                                <button
                                  className="icon-button"
                                  aria-label={`Reset token for ${a.name}`}
                                  title="Reset agent token"
                                  onClick={() => open("reset-token", a)}
                                >
                                  <KeyRound size={15} />
                                </button>
                                <button
                                  className="delete-icon"
                                  aria-label={`Delete agent ${a.name}`}
                                  title="Delete agent connection"
                                  onClick={() => open("delete-agent", a)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                      <div className="queue-note">
                        <Clock3 size={15} />
                        <span>
                          A background worker receives work automatically while
                          its computer is awake. Queued cards stay with their
                          assigned agent.
                        </span>
                      </div>
                    </section>
                  )}
                </div>
              )}
              <footer>
                <span>
                  <Radio size={13} />
                  Updates every 5 seconds
                </span>
                <span>Built for teams that build together.</span>
              </footer>
            </>
          )}
        </div>
      </main>
      {modal && (
        <div className="overlay" onClick={() => setModal("")}>
          <section
            className={
              "modal " +
              (["help", "connect", "detail"].includes(modal) ? "wide" : "")
            }
            role="dialog"
            aria-modal="true"
            aria-label={modal}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close dialog"
              onClick={() => setModal("")}
            >
              <X size={20} />
            </button>
            {["project", "agent", "task", "direction", "approve"].includes(
              modal,
            ) && (
              <form onSubmit={submit}>
                <div className="eyebrow">AGENTCOLLAB WORKSPACE</div>
                <h2>
                  {
                    (
                      {
                        project: "Create a project",
                        agent: "Connect an agent",
                        task: "New task card",
                        direction: "Propose a direction",
                        approve: "Approve development direction",
                      } as any
                    )[modal]
                  }
                </h2>
                {modal === "project" && (
                  <>
                    <p>
                      Give your team a shared home and a clear starting point.
                    </p>
                    <label>
                      Project name
                      <input
                        name="name"
                        required
                        maxLength={100}
                        placeholder="e.g. Academic Time Manager"
                      />
                    </label>
                    <label>
                      Initial development direction
                      <textarea
                        name="direction"
                        placeholder="What should the team achieve first?"
                      />
                    </label>
                    <label>
                      GitHub repository URL
                      <input
                        name="repo"
                        type="url"
                        placeholder="https://github.com/your-team/project"
                      />
                    </label>
                  </>
                )}
                {modal === "agent" && (
                  <>
                    <p>
                      Give an existing desktop session a fixed role. Its inbox
                      stays with that role.
                    </p>
                    <label>
                      Agent name
                      <input
                        name="name"
                        placeholder="e.g. Alex"
                        required
                        maxLength={100}
                      />
                    </label>
                    <label>
                      Role code
                      <input
                        name="role"
                        required
                        pattern="R(0|[0-9]{2,})"
                        maxLength={12}
                        defaultValue={nextRoleCode(agents)}
                        placeholder="R0, R01, R02…"
                      />
                    </label>
                    <p className="field-note">
                      R0 is the PM. Use R01, R02, and onward for your other
                      agents.
                    </p>
                    <label>
                      Responsibility
                      <textarea
                        name="responsibility"
                        maxLength={2000}
                        placeholder="Describe what this role is responsible for."
                      />
                    </label>
                    <label>
                      Desktop app
                      <select name="provider">
                        <option>Codex</option>
                        <option>Claude Code</option>
                      </select>
                    </label>
                  </>
                )}
                {modal === "task" && (
                  <>
                    <p>
                      Write a clear brief so the assigned agent can work
                      independently.
                    </p>
                    {agents.length === 0 ? (
                      <p className="notice">
                        Connect an agent first.{" "}
                        <button type="button" onClick={() => open("agent")}>
                          Add agent
                        </button>
                      </p>
                    ) : (
                      <>
                        <label>
                          Title
                          <input
                            name="title"
                            required
                            maxLength={180}
                            placeholder="What needs to be delivered?"
                          />
                        </label>
                        <div className="form-row">
                          <label>
                            Assigned agent
                            <select name="agent_id">
                              {agents.map((a: any) => (
                                <option key={a.id} value={a.id}>
                                  {a.name} · {a.role}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Priority
                            <select name="priority" defaultValue="medium">
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </label>
                        </div>
                        <label>
                          Scope and context
                          <textarea
                            name="description"
                            required
                            placeholder="What should change, and what context does the agent need?"
                          />
                        </label>
                        <label>
                          Acceptance criteria
                          <textarea
                            name="criteria"
                            required
                            placeholder="How will the PM verify the work?"
                          />
                        </label>
                      </>
                    )}
                  </>
                )}
                {modal === "direction" && (
                  <>
                    <p>
                      The PM can propose a direction. A human approves it before
                      it becomes the project’s current direction.
                    </p>
                    <label>
                      Proposed direction
                      <input
                        name="title"
                        required
                        maxLength={500}
                        placeholder="What should we build next?"
                      />
                    </label>
                    <label>
                      Reason and trade-offs
                      <textarea
                        name="rationale"
                        required
                        placeholder="Why is this the right next step?"
                      />
                    </label>
                  </>
                )}
                {modal === "approve" && (
                  <>
                    <p>
                      <strong>{selected.title}</strong>
                    </p>
                    <p>{selected.rationale}</p>
                    <label>
                      Your approval reply
                      <textarea
                        name="reply"
                        required
                        placeholder="e.g. Go ahead with this direction."
                      />
                    </label>
                  </>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="primary form-submit"
                  disabled={saving || (modal === "task" && !agents.length)}
                >
                  {saving
                    ? "Saving…"
                    : modal === "approve"
                      ? "Record approval"
                      : modal === "agent"
                        ? "Create agent connection"
                        : modal === "task"
                          ? "Queue task card"
                          : modal === "direction"
                            ? "Send for approval"
                            : "Create project"}
                  <ArrowRight size={15} />
                </button>
              </form>
            )}
            {(modal === "delete-project" || modal === "delete-agent") && (
              <>
                <div className="eyebrow">WORKSPACE MANAGEMENT</div>
                <h2>
                  Delete{" "}
                  {modal === "delete-project" ? "project" : "agent connection"}?
                </h2>
                <p>
                  <strong>{selected?.name}</strong> will move to Recently
                  deleted. You can restore it there.
                </p>
                <p>
                  {modal === "delete-project"
                    ? "Its agents will stop receiving work until the project is restored. Tasks, reports, and conversations stay saved with it."
                    : "This connection will stop receiving work. Its task cards and reports stay saved, and restoring the connection reactivates its token."}
                </p>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <div className="delete-actions">
                  <button className="secondary" onClick={() => setModal("")}>
                    Cancel
                  </button>
                  <button
                    className="danger"
                    disabled={saving}
                    onClick={async () => {
                      try {
                        await act(
                          modal === "delete-project"
                            ? {
                                action: "delete_project",
                                project_id: selected.id,
                              }
                            : {
                                action: "delete_agent",
                                project_id: selected.project_id,
                                agent_id: selected.id,
                              },
                        );
                        setChannel("general");
                        setModal("");
                      } catch {}
                    }}
                  >
                    {saving ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </>
            )}
            {modal === "trash" && (
              <>
                <h2>Recently deleted</h2>
                <p>Restore a project or agent connection removed by mistake.</p>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                {!data.deleted_projects?.length &&
                  !data.deleted_agents?.length && (
                    <p className="notice">Nothing deleted yet.</p>
                  )}
                {data.deleted_projects?.length > 0 && <h4>Projects</h4>}
                {data.deleted_projects?.map((p: any) => (
                  <div className="trash-row" key={p.id}>
                    <Layers size={17} />
                    <span>{p.name}</span>
                    <button
                      className="secondary"
                      disabled={saving}
                      onClick={async () => {
                        try {
                          await act({
                            action: "restore_project",
                            project_id: p.id,
                          });
                        } catch {}
                      }}
                    >
                      <RotateCcw size={13} />
                      Restore
                    </button>
                  </div>
                ))}
                {data.deleted_agents?.length > 0 && <h4>Agent connections</h4>}
                {data.deleted_agents?.map((a: any) => {
                  const projectDeleted = data.deleted_projects?.some(
                    (p: any) => p.id === a.project_id,
                  );
                  return (
                    <div className="trash-row" key={a.id}>
                      <Bot size={17} />
                      <span>
                        {a.name}
                        <small>
                          {projectDeleted
                            ? "Restore its project first"
                            : a.role}
                        </small>
                      </span>
                      <button
                        className="secondary"
                        disabled={saving || projectDeleted}
                        onClick={async () => {
                          try {
                            await act({
                              action: "restore_agent",
                              project_id: a.project_id,
                              agent_id: a.id,
                            });
                          } catch {}
                        }}
                      >
                        <RotateCcw size={13} />
                        Restore
                      </button>
                    </div>
                  );
                })}
              </>
            )}
            {modal === "reset-token" && (
              <>
                <KeyRound size={26} />
                <h2>Reset token for {selected?.name}?</h2>
                <p>
                  This generates a new private token and invalidates the
                  previous token. Any worker using the previous token will
                  disconnect.
                </p>
                <p>
                  Reconnect the worker with the replacement token. The agent
                  keeps its identity, role, Task Cards, and report history.
                </p>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <div className="delete-actions">
                  <button
                    className="secondary"
                    disabled={saving}
                    onClick={() => setModal("")}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={saving}
                    onClick={async () => {
                      try {
                        const result = await act({
                          action: "reset_agent_token",
                          project_id: selected.project_id,
                          agent_id: selected.id,
                        });
                        setToken(result.token);
                        setModal("connect");
                      } catch {
                        // act displays the request error in this dialog.
                      }
                    }}
                  >
                    {saving ? "Generating…" : "Generate replacement token"}
                  </button>
                </div>
              </>
            )}
            {modal === "switch" && (
              <>
                <h2>Your projects</h2>
                <div className="project-list">
                  {data.projects.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setProjectId(p.id);
                        setChannel("general");
                        setModal("");
                      }}
                    >
                      <Layers size={18} />
                      {p.name}
                      {p.id === projectId && <Check size={16} />}
                    </button>
                  ))}
                </div>
                <button className="primary" onClick={() => open("project")}>
                  <Plus size={16} />
                  New project
                </button>
              </>
            )}
            {modal === "connect" && (
              <>
                <div className="eyebrow">AGENT CONNECTION</div>
                <h2>Connect {selected?.name}</h2>
                <p><Link className="primary" href={`/setup?agent=${selected?.id}`}>Connect my current conversation <ArrowRight size={15}/></Link></p>
                <p>Recommended: let the conversation you already use control this role. The wizard supplies an inbox relay and a prompt to paste into that conversation.</p>
                <details><summary>Advanced: separate AI worker or direct token connection</summary>
                <p>
                  Save this agent token now. It is shown once. Treat it as a
                  private credential.
                </p>
                <div className="token-box">
                  <code>{token}</code>
                  <button
                    aria-label="Copy agent token"
                    onClick={() => copy(token)}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
                <p>
                  For automatic operation, install the local background worker
                  on the agent’s Mac. It checks the inbox and starts agent turns
                  when needed.
                </p>
                <a className="secondary" href="/agent-worker.py" download>
                  Download background worker
                </a>
                <pre>{`python3 agent-worker.py install --provider ${selected?.provider === "Claude Code" ? "claude" : "codex"} --workspace /absolute/path/to/project`}</pre>
                <p>
                  Run this in macOS Terminal. The installer asks for the agent
                  token and creates a service that restarts after login. Sign in
                  to the matching Codex or Claude Code CLI account first.
                </p>
                <h4>Manual session instructions</h4>
                <pre>{prompt}</pre>
                <button className="secondary" onClick={() => copy(prompt)}>
                  <Copy size={15} />
                  Copy connection instruction
                </button>
                <p className="notice">
                  Manual desktop sessions check messages only while running.
                  Automatic operation requires the local worker. The worker uses
                  a separate agent execution context and reconstructs project
                  context from the website.
                </p>
                </details>
              </>
            )}
            {modal === "detail" && (
              <>
                <div className="eyebrow">
                  TC-{short(selected.id)} · {selected.status}
                </div>
                <h2>{selected.title}</h2>
                <h4>Scope</h4>
                <p className="preserve">{selected.description}</p>
                <h4>Acceptance criteria</h4>
                <p className="preserve">{selected.criteria}</p>
                {selected.report && (
                  <>
                    <h4>Agent report</h4>
                    {Object.entries(JSON.parse(selected.report)).map(
                      ([key, value]) => (
                        <div className="report-field" key={key}>
                          <strong>{key}</strong>
                          <p>{String(value) || "—"}</p>
                        </div>
                      ),
                    )}
                  </>
                )}
                {selected.status === "review" && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const f = Object.fromEntries(new FormData(form));
                      try {
                        await act({
                          action: "review",
                          card_id: selected.id,
                          status: f.status,
                          note: f.note,
                        });
                        setModal("");
                      } catch {}
                    }}
                  >
                    <label>
                      Review feedback
                      <textarea
                        name="note"
                        required
                        placeholder="What passed, or what should be revised?"
                      />
                    </label>
                    <select name="status">
                      <option value="accepted">Accept report</option>
                      <option value="queued">Request revisions</option>
                    </select>
                    <button className="primary form-submit" disabled={saving}>
                      Submit review
                    </button>
                  </form>
                )}
              </>
            )}
            {modal === "github" && (
              <>
                <Github size={28} />
                <h2>GitHub workflow</h2>
                {project?.repo ? (
                  <p>
                    <a
                      href={
                        /^https:\/\/github.com\//.test(project.repo)
                          ? project.repo
                          : "#"
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      {project.repo}
                      <ArrowUpRight size={14} />
                    </a>
                  </p>
                ) : (
                  <p>Add a repository URL when creating your project.</p>
                )}
                <p>
                  Agents work in their local checkout, push a branch, and
                  include the PR URL in their structured report. The PM reviews
                  the report and uses its GitHub tools to merge the PR.
                </p>
                <p className="notice">
                  Accepting a report on this website records acceptance. GitHub
                  merging is performed by your connected PM agent.
                </p>
              </>
            )}
            {modal === "access" && (
              <>
                <LockKeyhole size={28} />
                <h2>Team accounts</h2>
                <p>
                  Signed in as <strong>{data.user}</strong>.
                </p>
                {data.account_role === "owner" ? (
                  <>
                    <p>Assign an agent role, then invite your teammate. They’ll choose their AI provider and connect their Mac in the setup wizard. Links expire after 48 hours.</p>
                    <form
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const fields = Object.fromEntries(new FormData(form));
                        await memberAction({
                          action: "create_invite",
                          username: fields.username,
                          agent_id: fields.agent_id,
                        });
                      }}
                    >
                      <label>
                        New teammate’s username
                        <input
                          name="username"
                          required
                          pattern={"[a-zA-Z0-9][a-zA-Z0-9_.\\-]{2,31}"}
                          placeholder="e.g. alex"
                          autoComplete="off"
                        />
                      </label>
                      <label>Assigned agent role
                        <select name="agent_id" required defaultValue="">
                          <option value="" disabled>Choose an available role</option>
                          {data.agents.filter((a: {account_id?: string; worker_id?: string}) => !a.account_id && !a.worker_id).map((a: {id: string; project_id: string; role: string; name: string}) => <option key={a.id} value={a.id}>{data.projects.find((p: {id: string; name: string}) => p.id === a.project_id)?.name} · {a.role} · {a.name}</option>)}
                        </select>
                      </label>
                      <p>Create an agent in the project first if no role is available.</p>
                      <button className="primary form-submit" disabled={saving}>
                        Create invitation
                        <ArrowRight size={14} />
                      </button>
                    </form>
                    {inviteLink && (
                      <div className="invite-result">
                        <h4>Copy this private invitation</h4>
                        <div className="token-box">
                          <code>{inviteLink}</code>
                          <button
                            aria-label="Copy invitation link"
                            onClick={() => copy(inviteLink)}
                          >
                            <Copy size={16} />
                          </button>
                        </div>
                        <p>
                          The teammate chooses their password when opening this
                          link.
                        </p>
                      </div>
                    )}
                    {members.map((member: any) => (
                      <div className="trash-row member-row" key={member.id}>
                        <span>
                          <strong>{member.username}</strong>
                          <small>
                            {member.role === "owner"
                              ? "Owner"
                              : !member.enabled
                                ? "Disabled"
                                : member.activated
                                  ? "Active member"
                                  : "Awaiting password setup"}
                          </small>
                          {member.agent_role && <small>Assigned role: {member.agent_role}</small>}
                        </span>
                        {member.role !== "owner" && (
                          <>
                            {!member.agent_role && member.enabled === 1 && <form onSubmit={async event => {
                              event.preventDefault();
                              const fields = new FormData(event.currentTarget);
                              await memberAction({action: "assign_role", account_id: member.id, agent_id: fields.get("agent_id")});
                            }}>
                              <select name="agent_id" required aria-label={`Assign role to ${member.username}`} defaultValue="">
                                <option value="" disabled>Choose role</option>
                                {data.agents.filter((a: {account_id?: string; worker_id?: string}) => !a.account_id && !a.worker_id).map((a: {id: string; role: string; name: string}) => <option key={a.id} value={a.id}>{a.role} · {a.name}</option>)}
                              </select>
                              <button className="secondary" disabled={saving}>Assign role</button>
                            </form>}
                            <button
                              className="secondary"
                              disabled={saving}
                              onClick={() =>
                                memberAction({
                                  action: "reset_invite",
                                  account_id: member.id,
                                })
                              }
                            >
                              {member.activated ? "Reset link" : "New link"}
                            </button>
                            {member.enabled === 1 && (
                              <button
                                className="delete-icon"
                                aria-label={`Disable ${member.username}`}
                                disabled={saving}
                                onClick={() =>
                                  memberAction({
                                    action: "disable_member",
                                    account_id: member.id,
                                  })
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <p>
                    Your workspace owner manages usernames and password setup
                    links.
                  </p>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <button className="secondary" onClick={logout}>
                  <LogOut size={15} />
                  Sign out
                </button>
              </>
            )}
            {modal === "help" && (
              <>
                <Terminal size={27} />
                <h2>Agent inbox API</h2>
                <p>New to the workspace? <Link href="/help">Read the user guide</Link> for tasks, conversations, approvals, and setup.</p>
                <p>
                  Use your existing desktop session to read its inbox, exchange
                  messages, and submit reports. Create an agent connection to
                  get its private token.
                </p>
                <pre>{`GET /api/agent?after=TIMESTAMP\nAuthorization: Bearer AGENT_TOKEN\n\nPOST /api/agent\nContent-Type: application/json\nAuthorization: Bearer AGENT_TOKEN\n\n{"action":"claim","card_id":"CARD_ID"}\n\n{"action":"message","channel":"general","body":"Question for the team"}\n\n{"action":"report","card_id":"CARD_ID","report":{\n  "summary":"What was delivered",\n  "changes":"Files or deliverables",\n  "checks":"Tests and acceptance evidence",\n  "pr":"https://github.com/.../pull/1",\n  "blockers":"Remaining issues"\n}}`}</pre>
                <p>
                  Reads update the agent’s heartbeat. A session is shown offline
                  after 45 seconds without a heartbeat. Its cards remain
                  assigned. An agent can claim one active card at a time.
                </p>
                <p className="notice">
                  Use your agent token in the Authorization header from any
                  computer. Human accounts use the workspace login page.
                  See the User guide for background-worker setup, connection
                  states, and recovery. Manual sessions must actively read their inbox.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
