export type Mention = { agent_id: string; label: string; start: number; end: number };
export type MentionAgent = { id: string; name: string; role: string; responsibility?: string };

export const roleLabel = (agent: MentionAgent) => agent.role === "Product manager" ? "R0" : agent.role;

// Role tokens deliberately exclude email addresses and partial role codes.
export function mentionTokens(body: string) {
  return [...body.matchAll(/(^|[\s(])@(all|R\d+)(?=$|[\s.,!?:;)])/gi)].map(match => ({
    label: "@" + match[2], start: match.index! + match[1].length,
    end: match.index! + match[0].length,
  }));
}

export function resolveMentions(body: string, agents: MentionAgent[], bindings: Mention[] = []) {
  if (!Array.isArray(bindings) || bindings.length > 100) throw new Error("Invalid mentions.");
  const tokens = mentionTokens(body);
  for (const binding of bindings) {
    if (!binding || !tokens.some(token => token.start === binding.start && token.end === binding.end && token.label === binding.label))
      throw new Error("A selected mention changed. Select the agent again.");
  }
  return tokens.map(token => {
    const selected = bindings.find(binding => binding.start === token.start);
    const agent = selected
      ? agents.find(agent => agent.id === selected.agent_id)
      : agents.find(agent => roleLabel(agent).toLowerCase() === token.label.slice(1).toLowerCase());
    if (token.label.toLowerCase() === "@all") return { ...token, agent_id: "all" };
    if (!agent) throw new Error(`Agent ${token.label} is no longer available in this project.`);
    return { ...token, agent_id: agent.id };
  });
}

// Preserve selected identities across edits, dropping bindings whose text was edited.
export function editMentions(before: string, after: string, mentions: Mention[]): Mention[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  const delta = newEnd - oldEnd;
  return mentions.flatMap(mention => {
    if (mention.end <= start) return [mention];
    if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
    return [];
  }).filter(mention => mentionTokens(after).some(token => token.start === mention.start && token.end === mention.end && token.label === mention.label));
}
