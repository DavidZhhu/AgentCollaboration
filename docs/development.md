# Development

For using an existing website, read the [user guide](user-guide.md). These instructions are for application developers. Joining a team does not require hosting another website.

## Source and dependencies

Use Node.js 22.13 or later. Node.js 24 is recommended for the SQLite-based checks included here. The application is at the repository root; the original desktop checkout uses a `web/` subdirectory.

```sh
git clone https://github.com/DavidZhhu/AgentCollaboration.git
cd AgentCollaboration
git switch -c feat/your-topic
npm ci
```

Read any applicable repository instructions before changing code, and follow the contribution workflow below. Use a separate worktree for concurrent tasks. The original desktop checkout and GitHub were initially created with different histories. Do not force-push, reset away changes, or merge unrelated histories to reconcile them: use a fresh GitHub clone and transfer only the task-owned changes after reviewing their baseline.

## Local database and owner account

The application requires its D1 schema even in a local preview. Build once to generate the Wrangler configuration:

```sh
npm run build
```

For a **new, empty local database only**, apply the SQL migrations in order:

```sh
for migration in drizzle/*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$migration" || break
done
```

For an existing database, apply only the migrations not already applied. Do not replay the full loop against an existing schema. Use local database flags for local testing; production migrations belong to an explicitly approved release.

The application uses its own username/password accounts and `ac_session` cookie. The framework’s mock ChatGPT sign-in does not provision these accounts. Configure `AUTH_BOOTSTRAP_TOKEN` in your local Worker environment (for example, the ignored `.dev.vars` file) with a private random value. Start the preview:

```sh
npm run dev
```

Use the printed loopback URL. On an uninitialised database, visit `/login#setup=YOUR_LOCAL_BOOTSTRAP_TOKEN`, choose an owner username and password, and create the owner account. Treat this as a local provisioning secret and do not commit it. Owner creation is single-use per database. Later users join through owner-created invitations.

The Mac worker installer requires an HTTPS workspace. Local HTTP preview is suitable for UI and API development; it is not a substitute for the real second-Mac onboarding test against a deployment.

## Useful source locations

| Path | Responsibility |
| --- | --- |
| `app/page.tsx` | Workspace UI, board, conversations, decisions, and account controls |
| `app/server.ts` | Workspace and agent operations, card lifecycle, worker leases |
| `app/auth.ts` | Accounts, invitations, password hashing, sessions |
| `app/setup/`, `app/setup-server.ts` | Teammate wizard, setup grants, connection tests |
| `app/help/guide.ts` | Shared user-guide content rendered by `/help` |
| `app/help/page.tsx` | Public product documentation page; no workspace data |
| `db/schema.ts`, `drizzle/` | D1 schema and generated SQL migrations |
| `public/agent-worker.py` | Local provider execution, polling, heartbeats, and Mac service installation |
| `tests/` | API, credential recovery, and offline worker checks |

The Markdown user guide is generated from `app/help/guide.ts` with `node --import tsx scripts/export-user-guide.mjs`. Update that shared content and rerun the exporter when changing product explanations.

## Checks

```sh
npx tsc --noEmit --incremental false
npm run build
npm run lint
node --import tsx tests/onboarding.mjs
node --import tsx --test tests/agent-token-reset.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
git diff --check
```

Lint has existing failures; do not add violations in changed code. API checks use an in-memory SQLite database. Worker protocol checks use fake provider executables; they do not establish live provider compatibility or install services.

For UI changes, also inspect desktop and narrow-screen layouts and follow the documented user workflow in a browser. Before releasing setup changes, verify a real invitation, worker installation, local-session resume, and AI test reply on another Mac for both providers. Report any unavailable checks honestly.

## Release and hosting

A merged PR, accepted task report, or passing build is not a deployed release. Obtain explicit owner approval before merge or deployment, apply pending migrations before code that needs them, preserve the existing site identity and access settings, and record the deployed commit. Existing workers may need an explicit script update when their protocol changes.

The committed `.openai/hosting.json` identifies this project’s existing hosted Site. Do not reuse that identity to deploy an independent copy. A separate deployment needs its own hosting identity, database, environment secrets, and owner provisioning.

See [Framework and hosting reference](runtime-development.md) for the inherited Vinext/Sites runtime details. Its optional framework authentication features are separate from the application’s account system.

## Contributing

1. Agree on the scope and create a short-lived `feat/`, `fix/`, or `chore/` branch from current `main`.
2. Use a separate worktree for concurrent sessions. Preserve another session’s files and changes.
3. Implement the change and run checks appropriate to it. Documentation-only edits need a content/link review; application changes also need TypeScript, build, and relevant behaviour checks.
4. Review the diff and stage explicit task-owned paths. Keep credentials, worker configurations, environment files, local databases, dependencies, and build output out of commits.
5. Push the feature branch and open a pull request explaining the change, validation, limitations, and any migration steps.
6. Obtain explicit project-owner approval before merging or deploying. Do not force-push shared history.

If terminal access to GitHub is restricted, connected GitHub tools may create the branch, upload only the task-owned changes based on the current remote head, and open a pull request. Verify the remote branch and commit before claiming the work is pushed. This does not synchronise local Git objects; reconcile local tracking later in a network-enabled checkout.
