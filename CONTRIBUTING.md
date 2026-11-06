# Contributing to AgentCollaboration

The application lives at the repository root. In the original desktop project, that root is the `web/` folder.

## Development cycle

1. Agree on the task and acceptance criteria.
2. Fetch GitHub's latest state and create a task branch from `origin/main`.
3. Implement the task, keeping commits focused on its scope.
4. Run checks and review the diff.
5. Push the branch and open a pull request to `main`.
6. After owner approval and passing checks, squash-merge, then update local `main` with `git pull --ff-only`.
7. Deploy only when explicitly authorized, recording the deployed commit.

For a fresh checkout:

```sh
git clone https://github.com/DavidZhhu/AgentCollaboration.git
cd AgentCollaboration
git switch -c feat/your-topic
npm ci
```

For concurrent sessions, start a separate worktree from a clean, synchronized checkout:

```sh
git fetch origin
git worktree add ../AgentCollaboration-your-topic -b feat/your-topic origin/main
```

Use `fix/` for bug fixes and `chore/` for maintenance. Use a different branch and worktree for each independent task.

## Validation and review

Use Node.js 22.13 or newer. For application changes:

```sh
npx tsc --noEmit --incremental false
npm run build
npm run lint
git diff --check
```

Exercise the changed behavior and relevant failure cases. For database changes, include generated migrations and explain compatibility and rollout steps. Documentation-only changes need a diff review rather than a production build.

GitHub Actions runs TypeScript and build checks. Lint is temporarily advisory because the existing code has lint failures; report its result and fix new violations in changed code. Make lint mandatory in a separate cleanup once the baseline is clean. Repository branch protection has not been configured by these files.

Before committing, inspect `git status` and `git diff`. Stage only the files or hunks owned by the task, then inspect `git diff --cached` and run `git diff --cached --check`. Never commit secrets or another session's work.

```sh
git add path/to/owned-file
git diff --cached
git diff --cached --check
git commit -m "feat: describe the change"
git push -u origin feat/your-topic
```

Open the pull request on GitHub using the template. Merging and production deployment require owner approval.

## Original desktop checkout: reconcile history once

The first GitHub upload reproduced the local source tree through the GitHub API, creating separate commit history. Its source matches local commit `a779227dcb28207a6f2308454c6aad86a484c5fb`, but its commit ancestry differs. Do not pull with unrelated-history merging, force-push, or reset this checkout to resolve that difference.

There is active uncommitted setup work in the original checkout. Preserve that checkout and let its session finish. Once ordinary GitHub network access is available, create a fresh clone using the commands above. Transfer only the task-owned changes into a feature branch in that clone, reviewing the diff against the uploaded baseline and excluding local configuration and generated files. Verify the transferred work before retiring the original checkout. This avoids replacing either history or mixing concurrent tasks.

## Network-restricted sessions

If terminal GitHub access fails, the connected GitHub tools can create a task branch, upload only its owned changes, and open a pull request. Base the remote commit on the current remote branch head and verify the resulting commit and branch. Record its URL and SHA. This does not synchronize local Git objects or branch tracking; complete synchronization in a network-enabled checkout before ordinary local pull/push operations. Keep the original desktop history issue above distinct from a network failure.
