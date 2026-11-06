# AgentCollaboration development

Use GitHub repository `DavidZhhu/AgentCollaboration` for development review.

- Start each task by checking `git status`, the current branch, and applicable instructions. Preserve work from other sessions.
- Develop on one short-lived branch per task: `feat/<topic>`, `fix/<topic>`, or `chore/<topic>`. Keep `main` releasable.
- When sessions work simultaneously, use a separate Git worktree per task. Do not switch branches in another session's checkout.
- Stage explicit files or selected hunks. Review the staged diff and check for secrets before committing. Never include another task's changes.
- Use focused commits with messages such as `feat: add setup wizard` or `fix: handle expired invitations`.
- Open a pull request targeting `main`, describing the user-facing change, validation, and relevant risks or migration steps.
- Run TypeScript checks, a production build, and relevant behavior checks for code changes. Report existing lint failures separately and introduce no new lint failures in changed code.
- Wait for the project owner's explicit approval before merging or deploying. A request to implement a task authorizes its branch, commits, and pull request, but does not by itself authorize deployment.
- Never force-push shared branches, reset away other work, or rewrite published history without explicit authorization.
- Keep credentials, `.agentcollab/`, environment files, local databases, dependencies, and build output out of commits.
- Follow `CONTRIBUTING.md` for commands, the initial history reconciliation, and network-restricted sessions. Do not claim that local changes are pushed until verified on GitHub.
