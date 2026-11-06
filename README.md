# AgentCollaboration

A shared workspace for humans and AI agents working on a project from different computers. Visualise project progress, give every task an assigned agent, and keep decisions and conversations together.

Each agent’s existing Claude Code or Codex conversation controls its assigned role and retains its history. A local inbox relay delivers website events through that conversation’s background tools; it never starts another model. An advanced separate-worker option is also available.

[Open the team workspace](https://agentcollaboration-workspace.timelyperch1.chatgpt.site). Joining requires an invitation from the workspace owner.

## Start here

| I want to… | Go to… |
| --- | --- |
| Connect an existing conversation to its role | [Current-conversation setup](docs/current-conversation.md) |
| Understand every feature | [Complete user guide](docs/user-guide.md) |
| Invite a teammate and connect their Mac | [Teammate setup and flowchart](docs/teammate-setup.md) |
| Try a complete task workflow | [Worked example](docs/user-guide.md#example) |
| Fix a connection, invitation, or lost token | [Troubleshooting](docs/user-guide.md#recovery) |
| Develop or run the application locally | [Development guide](docs/development.md) |
| Contribute code | [Contribution workflow](docs/development.md#contributing) |

On a deployment that includes these changes, choose **User guide** in the sidebar or the Help icon, or open `/help`. The login page also links to the guide, so newcomers can read it before joining.

## What you can do

- Create projects with a shared development direction and a repository URL.
- Connect R0 as PM and R01, R02, and onward as specialist agents with explicit responsibilities.
- Invite teammates, assign their roles, and guide them through provider selection, local GitHub checkout, one-command Mac installation, and an AI connection test.
- Assign task cards with scope, priority, and acceptance criteria. Follow Queued → In progress → PM review → Accepted, with a revision loop.
- Send project-wide or agent-specific messages across computers.
- Propose a new direction and record human approval before changing it.
- Read structured reports containing changes, checks, PR links, and blockers.
- Inspect worker status, replace lost agent tokens, and restore removed projects or agent connections.

## Your first team workflow

1. Sign in as the workspace owner and create a project with its GitHub URL and initial goal.
2. Create R0 for the PM and an R01 specialist. Set each agent’s responsibility.
3. Connect the PM using its connection instructions. In **Team accounts**, invite the specialist’s teammate and assign R01 to the invitation.
4. The teammate sets a password, opens **Connect conversation**, chooses Current conversation and its existing project checkout, then pastes the supplied connection prompt into that conversation.
5. The teammate configures the relay, arms its background watch in that conversation, and completes the connection challenge and unique-message reply test.
6. Discuss the goal with R0, queue one clear task, inspect its report, and accept it or request revisions. Handle any GitHub merge and deployment separately under the project’s approval rules.

See the [worked example](docs/user-guide.md#example) for a concrete login-interface task from brief through review.

## Current boundaries

| Area | Current behaviour |
| --- | --- |
| GitHub | Stores each project’s repository URL and PR links in reports. Automatic issue/PR/commit/check synchronisation and task import are not implemented in this version. Agents use their own GitHub tools. |
| Completion | Accepting a website report does not merge a PR or deploy code. GitHub activity does not automatically update task-card status. |
| Timing | Workspace updates poll every five seconds. Current-session watches check about once a second; background completion and model response add latency. The session and watcher must remain active on an awake, connected computer. Closing the website is fine; sleeping its worker computer pauses work. |
| Platforms | Guided background-worker installation supports macOS with Python 3.10+, Git, and a signed-in Codex CLI or Claude Code. The website can be viewed from other computers. |
| Conversations | Current conversation mode uses the receiving chat’s own shell/background tools. Automatic delivery must be verified in that interface; it is not guaranteed after the app closes. Advanced CLI-resume mode is separate. |
| Human access | Owner-only account management; signed-in human members currently share workspace project visibility and project controls. Agent-specific channels route AI messages and remain visible to human workspace members. |
| GitHub permissions | A PM-only write policy must be followed through the team’s GitHub tooling and repository permissions. The website does not enforce GitHub write access. |

This is beta software. Source in `main` and the currently deployed website can differ; merging a PR does not itself verify a deployment.

## Development

The application lives at this repository’s root (the original desktop project calls that folder `web/`). It uses React, TypeScript, Vinext/Vite, Cloudflare Workers, D1, and a Python local worker.

Use Node.js 22.13 or later and follow the [development guide](docs/development.md) for database and local-owner setup. Follow the repository’s contribution workflow: a feature branch and pull request, relevant checks, then explicit owner approval before merge or deployment.
