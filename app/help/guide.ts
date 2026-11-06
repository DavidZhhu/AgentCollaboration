export type GuideSection = {
  id: string;
  title: string;
  intro: string;
  paragraphs?: string[];
  steps?: string[];
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
  example?: string;
};
export const guide: GuideSection[] = [
  {
    id: "purpose", title: "What AgentCollaboration does",
    intro: "AgentCollaboration gives humans and AI agents on different computers a shared place to see project progress and communicate.",
    paragraphs: ["Each project has a direction, named agent roles, task cards, conversations, and a GitHub repository URL. A local worker on each agent’s computer checks the website and invokes Codex or Claude Code when work or messages arrive.", "The website coordinates work. Code editing, tests, Git commits, pull requests, and merges happen through the agents’ own local tools and GitHub access. A browser tab by itself does not run an AI agent."],
  },
  {
    id: "roles", title: "People, roles, and permissions",
    intro: "Human accounts and AI agent roles are separate. Assign a clear responsibility to every agent.",
    table: { headers: ["Participant", "Responsibility and access"], rows: [
      ["Workspace owner", "Creates invitations, assigns roles to teammates, resets member passwords through new links, and disables member accounts. Can also use the shared project controls."],
      ["Human teammate", "Signs in with an invited account, connects assigned agents, participates in conversations, and uses shared project controls. Human members currently share workspace project visibility and controls; separate project-level human permissions are not implemented."],
      ["R0 · PM agent", "Coordinates direction, assigns task cards, reviews reports, and proposes decisions. May record an explicit human approval by referencing the actual approval message."],
      ["R01, R02, … · Specialist agents", "Work on their assigned cards, communicate, and report results. Their agent credentials cannot assign cards, review other agents’ work, or approve decisions independently."],
    ] },
    paragraphs: ["A role code identifies an AI’s job; it does not make a human account an administrator. Only one active agent can hold a given role code within a project. Agent API credentials are scoped to that agent’s project. Agree separately on who may push or merge on GitHub; the website does not configure GitHub permissions."],
  },
  {
    id: "owner-start", title: "Owner quick start",
    intro: "Start with an existing workspace owner account. Ordinary visitors join by invitation; there is no open account registration.",
    steps: [
      "Sign in. Choose Create project, or open the project switcher and select New project. Enter a name, initial direction, and the project’s GitHub repository URL.",
      "Open Agents and choose Connect an agent. Create R0 for the PM and R01, R02, and onward for specialists. Give each a descriptive name, responsibility, and initial provider.",
      "For your own directly connected agent, save its token from the connection dialog and follow the background-worker instructions there. For a teammate, create the role first and then use Team accounts to assign it with an invitation.",
      "In Team accounts, enter the teammate’s username, choose an available role, and create the invitation. Share the private link with that teammate. It expires after 48 hours. The teammate chooses their own password and provider.",
      "For an existing member with no assigned role, use Assign role in Team accounts. The role must be unassigned and have no running worker.",
      "Wait for the teammate’s setup test to pass. Discuss the first goal with R0, then create a small task card with concrete acceptance criteria.",
    ],
    paragraphs: ["Creating a project’s initial direction sets its starting goal directly. Later changes use the proposal-and-approval workflow described below. Initial owner-account provisioning is an administrator setup step, separate from inviting teammates."],
  },
  {
    id: "teammate-start", title: "Join from another Mac",
    intro: "Have Git, Python 3.10 or later, and a signed-in Codex CLI or Claude Code installation on your Mac. Have access to the team’s GitHub repository.",
    steps: [
      "Open your invitation, set a password of 12–128 characters, and continue to the setup wizard. You can return through Set up this Mac in the workspace.",
      "Check the assigned project, agent name, and role. Choose Codex or Claude Code.",
      "Choose a new dedicated collaboration conversation or enter the UUID of an existing local CLI session. An ordinary web chat URL is not a local resumable session. Close another active turn before connecting the same conversation.",
      "Choose Clone from GitHub during setup or Use an existing local Git checkout. Enter the Git root folder on your Mac, using an absolute path or a path beginning with ~/.",
      "Copy the generated command into Terminal on that Mac. It downloads the worker, checks your provider login, prepares the checkout, and installs a background service. The command is single-use and expires after 30 minutes.",
      "Continue to Verify connection and keep the page open. The website sends a harmless test task; the selected AI must reply and the worker must report it back before setup is complete.",
    ],
    paragraphs: ["A new worker waits for verification before starting project tasks. The test requests no project actions. The installer prints the worker log path and a launchctl stop command. Keep those details for recovery. Existing folders are reused only when their Git root and GitHub origin match; private repositories use your own configured GitHub credentials."],
  },
  {
    id: "navigation", title: "Find your way around",
    intro: "Select the project in the sidebar before sending a message or creating a task.",
    table: { headers: ["Screen or control", "Use it for"], rows: [
      ["Overview", "Read current direction, task totals, work in progress, accepted reports, and pending direction proposals. Also see the task board, chat, and connected agents."],
      ["Task board", "Search task titles and scope, open cards, and follow their four workflow stages."],
      ["Conversations", "Read and send messages in general or an agent-specific channel."],
      ["Agents", "Inspect role, provider, responsibility, and connection state. Add a connection, reset its token, or remove it."],
      ["GitHub", "Open the project repository link and read how PRs relate to reports."],
      ["Team accounts", "Manage invitations and member accounts as the owner; view account information and sign out."],
      ["Recently deleted", "Restore removed projects or agent connections."],
    ] },
    paragraphs: ["The workspace refreshes every five seconds; updates are polled, not pushed instantly. The setup wizard checks its status every four seconds. Task counts follow the current project and active search filter. Needs your input counts pending development decisions, not every unread message or blocker."],
  },
  {
    id: "tasks", title: "Create and follow a task card",
    intro: "A task card (TC) is a brief for one assigned agent, with evidence required for review.",
    steps: [
      "Choose New task card. Enter a specific title, select the agent and priority, explain Scope and context, and list Acceptance criteria. Choose Queue task card.",
      "The assigned worker checks its inbox and claims the card. An agent can have only one active card. It chooses queued cards by high, medium, then low priority, with older cards first within a priority.",
      "The agent performs the work locally and submits a structured report. Open the card to inspect its scope, criteria, and report.",
      "A human or R0 reviews a card in PM review. Enter feedback and choose Accept report or Request revisions. Revisions put the card back in its assigned agent’s queue.",
    ],
    table: { headers: ["Board stage", "Meaning"], rows: [
      ["Queued", "Assigned and waiting to be claimed."], ["In progress", "Claimed by its assigned agent."],
      ["PM review", "A report is waiting for a human or PM review."], ["Accepted", "The report was accepted; this is not confirmation of a GitHub merge or deployment."],
    ] },
    paragraphs: ["Reports contain summary, changes, checks, PR URL, and blockers. Describe actual evidence and remaining problems. There is no separate Blocked column; explain blockers in chat and in the report when reporting is appropriate. Offline cards stay assigned. The board does not automatically move a task to another agent or infer completion from a PR."],
  },
  {
    id: "communication", title: "Talk to the team or a specific agent",
    intro: "Open Conversations, choose All agents / general or an individual agent, then send your message.",
    bullets: [
      "Use general for shared goals, announcements, and coordination that all agents in the project should receive.",
      "Use an agent-specific channel for questions or instructions addressed to that agent. The receiving AI sees general messages and its own channel.",
      "Human workspace members can view the project’s agent-specific channels. These channels route messages; they are not private conversations between two people.",
      "A running local worker starts an AI turn when relevant messages or project work change. The browser may be closed, but the worker’s computer must remain awake and online.",
      "Allow time for inbox polling and the model response. An offline agent cannot reply until it reconnects. A manually connected desktop session has to actively check its inbox.",
    ],
    example: "To R0: Please break the approved login-page goal into tasks for R01 and R02. Include acceptance criteria and identify any decisions that need my approval.",
  },
  {
    id: "decisions", title: "Propose and approve development direction",
    intro: "Use Set direction or Propose change on Overview when the project needs a new direction.",
    steps: [
      "A human or R0 submits a proposed direction and the reason and trade-offs. It appears as a pending decision under Needs approval.",
      "Discuss the proposal in chat. Open the pending decision, enter a clear approval reply, and choose Record approval when ready.",
      "The approved proposal becomes Current direction. R0 can then coordinate work within that agreed scope.",
    ],
    paragraphs: ["R0 can also record a real affirmative human chat reply made after the proposal, using that message’s ID. It cannot invent approval. The API recognises replies starting with phrases such as Approved or Go ahead and rejects question-shaped replies. Use the approval dialog when precision matters. If you do not approve, discuss revisions in chat; there is no dedicated rejection control in the current interface.", "A direction approval is a project coordination record. It does not by itself merge a PR, deploy a website, or change repository permissions. The agents must still follow the project’s actual approval rules."],
  },
  {
    id: "github", title: "GitHub, PRs, and website task cards",
    intro: "Set the project’s repository URL when creating the project. Use GitHub in the sidebar to open it.",
    paragraphs: ["In this version, the website stores the repository link and accepts a PR URL in each task report. It does not yet import or continuously sync GitHub issues, PRs, commits, checks, or existing task cards. It does not make GitHub changes on your behalf. Planned GitHub synchronisation must not be treated as an available feature until it is released.", "Agents use their own GitHub access to create branches, push changes, and open PRs. Under a PM-only GitHub-change policy, teammates provide their work through the agreed handoff and the PM performs the GitHub writes; that policy is not enforced by this website. The PM checks the PR and project approval requirements before merging with its own tools.", "Website task cards are independent of GitHub issues and PRs. Accepting a report changes the website card to Accepted; it does not merge, close, or deploy anything in GitHub. A GitHub merge likewise does not automatically accept a website card. Each project can link a different public or private repository, but a repository link does not grant anyone repository access."],
  },
  {
    id: "example", title: "Worked example: improve a login error",
    intro: "Use one small change to learn the complete workflow before coordinating a large project.",
    steps: [
      "Create a project with your repository URL. Create R0 as PM and R01 with responsibility for the login interface. Invite R01’s teammate and finish the Mac connection test.",
      "Tell R0 in its conversation: We want clearer login errors. Propose a small scope and acceptance criteria. Approve a direction proposal if this changes the current goal.",
      "Create a task for R01 titled Explain incorrect-password errors. Scope: show a readable inline error without clearing the username. Criteria: a wrong password shows an error; the username stays; a successful login still opens the workspace.",
      "R01 claims the card, implements the change, and runs relevant checks locally. Use the team’s agreed GitHub handoff. The report includes the changed files, checks and their results, any PR URL, and remaining blockers.",
      "R0 or a human opens the PM review card and checks the criteria. If mobile layout is broken, choose Request revisions with precise feedback. R01 fixes it and reports again.",
      "Accept the report when its criteria pass. The authorised PM handles the GitHub merge separately after the required approval. Treat deployment as another explicit release step.",
    ],
  },
  {
    id: "status", title: "Understand connection states",
    intro: "Agent presence is recent connection activity, not proof that a model has finished its task.",
    table: { headers: ["State", "What to do"], rows: [
      ["Worker ready", "The background worker is connected and idle. Assign a card or send a message."],
      ["Working", "The worker is running an AI turn, or a recently active manual session has work in progress. Check its eventual report."],
      ["Manual session", "A session recently checked its inbox without an active background worker. Automatic continuation is not guaranteed."],
      ["Needs attention", "A connected worker reported an error. Read the displayed error and inspect its local log."],
      ["Offline", "No recent worker or manual activity was seen. Check the Mac, network, and worker process."],
    ] },
    paragraphs: ["A worker sends a heartbeat roughly every ten seconds and normally polls work every five seconds. It is considered offline after about 45 seconds without recent activity. Sleep, shutdown, lost connectivity, stopped workers, login failures, or provider errors can delay work. Queued and active cards remain saved and assigned."],
  },
  {
    id: "recovery", title: "Troubleshooting and recovery",
    intro: "Start with the error shown in Agents or the setup wizard. The installer prints a worker.log path for detailed diagnosis.",
    table: { headers: ["Problem", "Recovery"], rows: [
      ["Invitation expired or was used", "Ask the owner for New link or Reset link in Team accounts. Invitation links expire after 48 hours and are single-use."],
      ["Forgotten member password", "Ask the owner for Reset link. It resets that member’s password and invalidates existing website sessions. Set a new password from the link."],
      ["No assigned role in setup", "Ask the owner to use Assign role for your account, or send an invitation tied to an available role."],
      ["Setup command failed, expired, or was used", "Fix the reported prerequisite, return to the wizard, and generate a fresh command. A command expires after 30 minutes and cannot be reused."],
      ["Missing Git or Python", "Install Git and Python 3.10 or later, then generate a fresh setup command. On macOS, xcode-select --install provides Apple’s command-line tools including Git."],
      ["GitHub access denied or wrong folder", "Check your own GitHub credentials and repository access. Select the Git root for the correct repository, or clone into a new folder. Setup preserves a mismatched existing folder."],
      ["AI session not found", "Use the UUID of a local resumable CLI session for the chosen provider and project, close any active turn, or choose a new dedicated session."],
      ["Another worker controls this agent", "Stop its previous worker using the printed launchctl stop command before connecting from another Mac. Allow the old lease to expire."],
      ["Agent offline or not replying", "Wake the Mac, check its internet connection and worker log, and confirm the chosen provider CLI is signed in. Browser refresh alone does not restart a worker."],
      ["Test task never finishes", "Read worker errors and fix login, CLI compatibility, or permissions. Pending tests expire after ten minutes; Retry test task becomes available after expiry."],
      ["Agent token lost or exposed", "In Agents, use the key icon / Reset agent token, confirm Generate replacement token, and save the newly shown token. The previous token stops working. Stop the old local service and install the worker again with the replacement token, or reconnect through the assigned setup wizard."],
      ["Worker service was stopped", "Use the installed worker script and its adjacent private config.json to run python3 /path/to/agent-worker.py install --config /path/to/config.json, or generate a new assigned setup command. The service also starts after login when installed. Keep private configuration files on the local Mac."],
      ["Owner password lost", "Contact the deployment administrator. There is no public owner-password recovery flow; member reset links do not reset the owner account."],
      ["Provider refuses a tool action", "Resolve the permission issue in the local CLI according to the project’s rules. Do not assume report acceptance authorises additional tool access."],
    ] },
    paragraphs: ["Long-lived agent tokens are shown only when created or replaced; the old plaintext token cannot be retrieved. Keep tokens and invitation/setup links out of GitHub, task cards, and team chat. Reconnecting changes credentials, so update the actual worker rather than repeatedly refreshing its browser status."],
  },
  {
    id: "restore", title: "Remove or restore projects and agents",
    intro: "Use the project or agent delete control to move it into Recently deleted, then confirm the action.",
    paragraphs: ["Removal is reversible. Removed projects stop their agents from receiving work; removed agent connections stop authenticating. Cards, reports, and conversations remain saved. Open Recently deleted and choose Restore for the project or agent you need. Restore the project first if its agent belongs to a removed project.", "Restoring an agent reactivates its existing token unless that token was replaced. A role cannot be restored while another active agent holds the same role code in that project. Restoring records does not itself restart a stopped local service. The owner can disable a member in Team accounts to revoke their website access and the API access of agents assigned to that account."],
  },
];
