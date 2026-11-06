"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Copy, GitBranch, Layers, LoaderCircle, Terminal } from "lucide-react";
import Link from "next/link";
import type { SetupAgent, SetupData } from "../setup-types";
import { readApiResponse } from "../api-response";
import "../workspace.css";
import "./setup.css";
const steps = ["Your invitation", "AI & conversation", "Project files", "Connect your Mac", "Verify & finish"];
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export default function Setup() {
    const [data, setData] = useState<SetupData | null>(null), [agentId, setAgentId] = useState(""), [step, setStep] = useState(0);
    const [provider, setProvider] = useState("Codex"), [sessionMode, setSessionMode] = useState("new"), [sessionId, setSessionId] = useState("");
    const [folder, setFolder] = useState(""), [clone, setClone] = useState(true), [command, setCommand] = useState(""), [expires, setExpires] = useState(0);
    const [error, setError] = useState(""), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false), [now, setNow] = useState(0);
    const autoTest = useRef("");
    const selectedId = useRef("");
    const agent = data?.agents.find((a) => a.id === agentId);
    const check = data?.checks.find((c) => c.agent_id === agentId);
    const online = !!agent?.worker_id && (agent.worker_seen || 0) > now - 45000;
    const passed = check?.status === "passed";
    const selectAgent = useCallback((selected: SetupAgent) => {
        selectedId.current = selected.id;
        setAgentId(selected.id);
        setProvider(selected.provider);
        setFolder(`~/Developer/${selected.repo.split("/").filter(Boolean).pop()?.replace(/\.git$/, "") || "team-project"}`);
        setCommand("");
        setCopied(false);
        setStep(0);
        autoTest.current = "";
    }, []);
    const refresh = useCallback(async () => {
        try {
            const response = await fetch("/api/setup", { cache: "no-store" });
            if (response.status === 401) {
                window.location.replace("/login?next=setup");
                return;
            }
            const result = await readApiResponse(response);
            if (!response.ok)
                throw new Error(result.error);
            const state = result as SetupData;
            setData(state);
            setNow(Date.now());
            const selected = state.agents.find(a => a.id === selectedId.current) || state.agents[0];
            if (selected && selected.id !== selectedId.current)
                selectAgent(selected);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Unable to load setup.");
        }
    }, [selectAgent]);
    useEffect(() => {
        const initial = setTimeout(() => { void refresh(); }, 0);
        const interval = setInterval(() => { void refresh(); }, 4000);
        return () => { clearTimeout(initial); clearInterval(interval); };
    }, [refresh]);
    const action = useCallback(async (body: Record<string, unknown>) => {
        const response = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, agent_id: agentId }) });
        const result = await readApiResponse(response);
        if (!response.ok)
            throw new Error(result.error);
        return result;
    }, [agentId]);
    const test = useCallback(async () => {
        setBusy(true);
        setError("");
        try {
            await action({ action: "test" });
            await refresh();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Setup failed. Please retry.");
        }
        finally {
            setBusy(false);
        }
    }, [action, refresh]);
    useEffect(() => {
        if (step === 4 && online && autoTest.current !== agentId) {
            const timer = setTimeout(() => { autoTest.current = agentId; void test(); }, 0);
            return () => clearTimeout(timer);
        }
    }, [step, online, agentId, test]);
    async function generate() {
        setBusy(true);
        setError("");
        try {
            const result = await action({ action: "command", provider, session_mode: sessionMode, session_id: sessionId.trim(), folder, clone_repo: clone });
            const origin = window.location.origin;
            // No long-lived agent token is included in shell history. This grant expires in 30 minutes.
            setCopied(false);
            setCommand(`workdir=$(mktemp -d) && curl --fail --silent --show-error ${quote(origin + "/agent-worker.py")} -o "$workdir/agent-worker.py" && python3 "$workdir/agent-worker.py" onboard --site ${quote(origin)} --code ${quote(result.code)}`);
            setExpires(result.expires_at);
            setStep(3);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Setup failed. Please retry.");
        }
        finally {
            setBusy(false);
        }
    }
    async function copy() {
        try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
        }
        catch {
            setError("Clipboard access is unavailable. Select the command and copy it manually.");
        }
    }
    function move(next: number) { setError(""); setStep(next); }
    return <div className="setup-page">
    <header className="setup-header"><Link href="/" className="brand"><span><Layers size={24}/></span>agent<span className="brand-light">collab</span></Link><Link href="/" className="secondary"><ArrowLeft size={15}/> Workspace</Link></header>
    <main className="setup-shell">
      <aside className="setup-sidebar"><div className="eyebrow">TEAMMATE SETUP · MACOS</div><h1>Your Mac.<br />One connected team.</h1><p>Bring your AI into the workspace, with your assigned role and project ready to go.</p>
        <nav aria-label="Setup progress"><ol>{steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><span>{index < step ? <Check size={15}/> : index + 1}</span><strong>{label}</strong></li>)}</ol></nav>
        <details className="setup-flow"><summary>See the setup flow</summary><ol><li>Accept invitation → assigned role</li><li>Codex or Claude Code</li><li>New session or existing local session</li><li>Clone GitHub repo or use checkout</li><li>Run one command → worker connects</li><li>Test task → AI reply → ready</li></ol><p>If a step fails, fix it here and retry.</p></details>
      </aside>
      <section className="setup-card" aria-live="polite">
        {!data ? <p><LoaderCircle className="spin" size={20}/> Loading your invitation…</p> : !agent ? <><div className="eyebrow">ROLE REQUIRED</div><h2>No assigned agent yet</h2><p>{data.owner ? "Create an agent role in the workspace, then use Team accounts to invite your teammate and assign that role." : "Ask the workspace owner to assign an agent role to your account. Your setup will appear here once it’s assigned."}</p><Link href="/" className="primary">Open workspace <ArrowRight size={16}/></Link></> : <>
          <div className="setup-card-top"><span className="eyebrow">STEP {step + 1} OF 5</span><span className="setup-role">{agent.role} · {agent.project_name}</span></div>
          {data.agents.length > 1 && <label>Assigned agent<select value={agentId} onChange={e => { const chosen = data.agents.find(a => a.id === e.target.value); if (chosen)
            selectAgent(chosen); }}>{data.agents.map((a) => <option key={a.id} value={a.id}>{a.role} · {a.name}</option>)}</select></label>}
          {step === 0 && <><h2>Welcome, {data.user}.</h2><p>Your owner has assigned you <strong>{agent.role}</strong> as <strong>{agent.name}</strong> in {agent.project_name}.</p><div className="setup-callout"><strong>Before you continue</strong><ul><li>A Mac with Python 3.10 or later and Git installed.</li><li>Codex CLI or Claude Code installed and signed in.</li><li>Access to the team’s GitHub repository.</li></ul></div><p>The worker runs while your Mac is awake and online, and restarts after login. AI turns use your selected provider account.</p><button className="primary" onClick={() => move(1)}>Choose my AI <ArrowRight size={16}/></button></>}
          {step === 1 && <><h2>Choose your AI.</h2><p>Your role stays fixed. Choose the AI account and conversation that will carry it out.</p><div className="setup-options">{["Codex", "Claude Code"].map(item => <button key={item} className={provider === item ? "selected" : ""} onClick={() => { setProvider(item); setCommand(""); }} aria-pressed={provider === item}><Terminal size={20}/><strong>{item}</strong><small>Installed and signed in on this Mac</small></button>)}</div><label>Conversation<select value={sessionMode} onChange={e => { setSessionMode(e.target.value); setCommand(""); }}><option value="new">Create a dedicated collaboration session</option><option value="existing">Connect an existing local CLI conversation</option></select></label>{sessionMode === "existing" && <><label>Session UUID<input value={sessionId} onChange={e => setSessionId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></label><div className="setup-callout">Use a session from this Mac and project. {provider === "Codex" ? "Find its ID in Codex’s session details or CLI resume picker." : "Use /status in Claude Code to find the session ID."} Close its active turn before connecting. A web chat link alone cannot be resumed by the local CLI.</div></>}<div className="setup-actions"><button className="secondary" onClick={() => move(0)}>Back</button><button className="primary" disabled={sessionMode === "existing" && !/^[a-f0-9-]{36}$/i.test(sessionId.trim())} onClick={() => move(2)}>Project files <ArrowRight size={16}/></button></div></>}
          {step === 2 && <><h2>Get your project ready.</h2><p>The AI works on a local checkout of your team’s GitHub repository.</p><div className="setup-callout"><GitBranch size={18}/><strong>{agent.repo || "No GitHub repository configured"}</strong></div><label>Project source<select value={clone ? "clone" : "existing"} onChange={e => { setClone(e.target.value === "clone"); setCommand(""); }}><option value="clone">Clone from GitHub during setup</option><option value="existing">Use an existing local Git checkout</option></select></label><label>Folder on your Mac<input value={folder} onChange={e => { setFolder(e.target.value); setCommand(""); }} placeholder="~/Developer/team-project"/></label><p>{clone ? "The installer clones into this folder. An existing checkout is reused only when its GitHub origin matches." : "Enter the folder that contains your Git checkout. Setup will verify its repository matches the project."} Private repositories use your own GitHub access.</p><div className="setup-actions"><button className="secondary" onClick={() => move(1)}>Back</button><button className="primary" disabled={busy || !folder.trim()} onClick={generate}>{busy ? "Preparing…" : "Get setup command"}<ArrowRight size={16}/></button></div></>}
          {step === 3 && <><h2>Connect this Mac.</h2><p>Paste this command into Terminal on the Mac that will run your AI.</p>{command ? <><pre className="setup-command">{command}</pre><button className="secondary" onClick={copy}>{copied ? <Check size={16}/> : <Copy size={16}/>}{copied ? "Copied" : "Copy command"}</button><p className="setup-caption">Single use · expires {new Date(expires).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Keep it private.</p>{now > expires && <p className="error">This command expired. Go back to generate a new one.</p>}</> : <p>Go back to generate a fresh setup command.</p>}<div className="setup-callout">The command downloads the worker, checks your AI login, prepares the repository, and installs a background service. Terminal prints how to stop it and where to find its log.</div><p className="setup-status">{online ? <CheckCircle2 size={18}/> : <LoaderCircle className="spin" size={18}/>}{online ? "Worker detected on your Mac" : "Waiting for your Mac to connect…"}</p><div className="setup-actions"><button className="secondary" onClick={() => move(2)}>Back</button><button className="primary" onClick={() => move(4)}>Verify connection <ArrowRight size={16}/></button></div></>}
          {step === 4 && <><h2>{passed && online ? "You’re ready to collaborate." : "Let’s check the whole connection."}</h2><p>A harmless test task travels from this website to your selected AI. The worker reports the AI’s reply back here.</p><ul className="setup-checklist"><li><span>{online ? "✓" : "○"}</span>Mac worker connected</li><li><span>{check ? "✓" : "○"}</span>Test task sent</li><li><span>{passed ? "✓" : "○"}</span>AI reply received and verified</li></ul>{passed && <div className="setup-callout"><strong>Test report</strong><p>{check.summary}</p></div>}{!online && <p>The website hasn’t detected your worker yet. Run the command in Terminal, then keep this page open.</p>}{check?.status === "pending" && <p>{now - check.created_at > 600000 ? "The test expired. Retry below." : "Waiting for the AI’s reply. This may take a few minutes."}</p>}{agent.worker_status === "error" && <div role="alert" className="error">{agent.worker_error}</div>}<div className="setup-actions"><button className="secondary" onClick={() => move(3)}>Back</button>{passed && online ? <Link href="/" className="primary">Open workspace <ArrowRight size={16}/></Link> : <button className="primary" disabled={!online || busy || (check?.status === "pending" && now - check.created_at < 600000)} onClick={test}>{busy ? "Sending…" : "Retry test task"}</button>}</div><details className="setup-troubleshoot"><summary>Connection help</summary><ul><li>Missing Python or Git: install the required tool, then generate a fresh command.</li><li>GitHub access denied: sign in with your own GitHub account and check repository access.</li><li>Session not found: verify the session UUID and local project, or choose a new conversation.</li><li>Worker conflict: stop the previous worker using its printed stop command.</li><li>AI login or permissions error: resolve it in your provider CLI, then allow the worker to retry.</li></ul></details></>}
        </>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </main>
  </div>;
}
