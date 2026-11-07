"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { AtSign, Send, X } from "lucide-react";
import { editMentions, mentionTokens, roleLabel, type Mention, type MentionAgent } from "../app/mentions";
import "./mention-chat.css";

type Agent = MentionAgent & { worker_seen?: number; worker_status?: string; worker_id?: string; account_id?: string };
type Delivery = { id: string; agent_id: string; status: string };
export function connectionLabel(agent: Agent) {
  if (!agent.worker_id || !agent.worker_seen || Date.now() - agent.worker_seen > 45000 || agent.worker_status === "stopped") return "Offline";
  if (agent.worker_status === "error") return "Needs attention";
  return agent.worker_status === "running" ? "Working" : "Ready";
}

export function MentionComposer({ agents, channel, disabled, saving, onSend }: {
  agents: Agent[]; channel: string; disabled: boolean; saving: boolean;
  onSend: (body: string, mentions: Mention[]) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [bindings, setBindings] = useState<Mention[]>([]);
  const [search, setSearch] = useState<{ start: number; end: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    input.current?.focus();
    input.current?.setSelectionRange(caret, caret);
    pendingCaret.current = null;
  }, [text]);
  const locked = disabled || saving || sending;
  const choices = [
    ...agents.map(agent => ({ id: agent.id, label: "@" + roleLabel(agent), name: agent.name, detail: agent.responsibility || (roleLabel(agent) === "R0" ? "Product manager" : "Project agent"), status: connectionLabel(agent) })),
    { id: "all", label: "@all", name: "All agents", detail: `Notify all ${agents.length} project agents`, status: "Team" },
  ].filter(item => !search || `${item.label} ${item.name} ${item.detail}`.toLowerCase().includes(search.query.toLowerCase()));
  const selectedIndex = Math.min(index, Math.max(0, choices.length - 1));
  const tokens = mentionTokens(text).map(token => ({ ...token, agent_id: bindings.find(binding => binding.start === token.start)?.agent_id || (token.label.toLowerCase() === "@all" ? "all" : agents.find(agent => roleLabel(agent).toLowerCase() === token.label.slice(1).toLowerCase())?.id) }));
  const recipients = new Set(tokens.flatMap(token => token.agent_id === "all" ? agents.map(agent => agent.id) : token.agent_id ? [token.agent_id] : []));
  if (channel !== "general") recipients.add(channel);
  else if (!tokens.length) agents.filter(agent => roleLabel(agent) === "R0").forEach(agent => recipients.add(agent.id));

  function findSearch(value: string, caret: number) {
    const match = value.slice(0, caret).match(/(^|[\s(])@([^\s@]*)$/);
    const next = match ? { start: caret - match[2].length - 1, end: caret, query: match[2] } : null;
    setSearch(next);
    if (next?.start !== search?.start || next?.query !== search?.query) setIndex(0);
  }
  function update(value: string, caret: number) {
    setBindings(editMentions(text, value, bindings));
    setText(value);
    findSearch(value, caret);
  }
  function choose(optionIndex: number) {
    if (!search) return;
    const choice = choices[optionIndex];
    const value = text.slice(0, search.start) + choice.label + " " + text.slice(search.end);
    setBindings([...editMentions(text, value, bindings), { agent_id: choice.id, label: choice.label, start: search.start, end: search.start + choice.label.length }]);
    setText(value);
    setSearch(null);
    pendingCaret.current = search.start + choice.label.length + 1;
  }
  async function send() {
    if (locked || !text.trim()) return;
    setSending(true);
    try {
      await onSend(text, bindings);
      setText(""); setBindings([]); setSearch(null);
    } catch { /* The workspace displays the error; retain the draft for retry. */ }
    finally { setSending(false); }
  }
  return <div className="mention-composer-wrap">
    <form className="composer mention-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      {search && !locked && <div className="mention-picker" id="mention-options" role="listbox" aria-label="Mention a project agent">
        <div className="mention-picker-heading">Notify an agent <span>↑ ↓ select · Enter insert · Esc close</span></div>
        {choices.length ? choices.map((choice, optionIndex) => <button type="button" role="option" id={`mention-option-${optionIndex}`} aria-selected={selectedIndex === optionIndex} key={choice.id}
          className={selectedIndex === optionIndex ? "active" : ""} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setIndex(optionIndex)} onClick={() => choose(optionIndex)}>
          <span className="mention-option-code">{choice.label}</span><span className="mention-option-info"><strong>{choice.name}</strong><small>{choice.detail}</small></span><span className={`mention-connection ${choice.status.toLowerCase().replaceAll(" ", "-")}`}>{choice.status}</span>
        </button>) : <div className="mention-no-results">No matching agents in this project.</div>}
      </div>}
      <div className="mention-input-row">
        <button type="button" className="mention-trigger" aria-label="Mention an agent" disabled={locked} onClick={() => {
          const caret = input.current?.selectionStart ?? text.length;
          const prefix = caret && !/\s/.test(text[caret - 1]) ? " @" : "@";
          const value = text.slice(0, caret) + prefix + text.slice(caret);
          pendingCaret.current = caret + prefix.length;
          update(value, caret + prefix.length);
        }}><AtSign size={17} /></button>
        <textarea ref={input} role="combobox" aria-label="Message" aria-autocomplete="list" aria-expanded={!!search} aria-controls="mention-options" aria-activedescendant={search && choices.length ? `mention-option-${selectedIndex}` : undefined}
          placeholder="Message the team… use @ to choose who replies" rows={2} value={text} disabled={locked}
          onChange={event => update(event.target.value, event.target.selectionStart)}
          onSelect={event => { if (document.activeElement === event.currentTarget) findSearch(event.currentTarget.value, event.currentTarget.selectionStart); }}
          onBlur={() => setSearch(null)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (search && event.key === "Escape") { event.preventDefault(); setSearch(null); return; }
            if (search && choices.length && ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) {
              event.preventDefault();
              if (event.key === "ArrowDown" || event.key === "ArrowUp") setIndex((selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
              else choose(selectedIndex);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
          }} />
        <button className="send" aria-label="Send message" disabled={locked || !text.trim()}><Send size={16} /></button>
      </div>
      {!!tokens.length && <div className="mention-chips" aria-label="Selected mentions">{tokens.map(token => <button type="button" className="mention-chip" key={token.start} disabled={locked} title="Remove mention" onClick={() => update(text.slice(0, token.start) + text.slice(token.end), token.start)}>{token.label}<X size={10} /></button>)}</div>}
      <div className="mention-routing" aria-live="polite">{recipients.size ? `Will notify ${agents.filter(agent => recipients.has(agent.id)).map(agent => "@" + roleLabel(agent)).join(", ")}` : "No agent selected · add an @mention"}<span>Enter to send · Shift+Enter for a new line</span></div>
    </form>
  </div>;
}

export function MentionMessage({ body, mentions }: { body: string; mentions?: string }) {
  let parsed: Mention[] = [];
  try { parsed = JSON.parse(mentions || "[]"); } catch { /* Legacy plain-text message. */ }
  const parts = []; let cursor = 0;
  for (const mention of parsed) {
    if (mention.start < cursor || body.slice(mention.start, mention.end) !== mention.label) continue;
    parts.push(body.slice(cursor, mention.start));
    parts.push(<mark className="mention-inline" key={mention.start} title={mention.agent_id === "all" ? "All project agents" : "Mentioned project agent"}>{mention.label}</mark>);
    cursor = mention.end;
  }
  parts.push(body.slice(cursor));
  return <p>{parts}</p>;
}

export function MessageDeliveries({ deliveries, agents }: { deliveries: Delivery[]; agents: Agent[] }) {
  if (!deliveries.length) return null;
  return <div className="message-deliveries" aria-label="Message delivery">{deliveries.map(delivery => {
    const agent = agents.find(agent => agent.id === delivery.agent_id);
    const offline = !agent || connectionLabel(agent) === "Offline";
    const status = delivery.status === "replied" ? "Replied" : delivery.status === "queued" ? `Queued${offline ? " · agent offline" : ""}` : delivery.status === "responding" ? offline ? "Received · agent offline" : agent?.worker_status === "running" ? "Responding" : "Received" : "Received";
    return <span key={delivery.id} className={`delivery-${delivery.status}`}>{agent ? "@" + roleLabel(agent) : "Removed agent"} · {status}</span>;
  })}</div>;
}
