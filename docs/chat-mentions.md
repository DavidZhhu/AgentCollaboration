# Chat mentions

Type `@` in the message composer to search project agents by role, name or responsibility. Use arrows to navigate, Enter or Tab to insert, and Escape to dismiss. You can select multiple agents or `@all`. Enter sends; Shift+Enter adds a newline. A failed send preserves the draft. Changing project or channel opens a fresh composer.

## Routing

| Sender and message | Recipients |
| --- | --- |
| Human, general, no mentions | Active PM |
| Human, general, with mentions | Mentioned agents |
| Human, agent-specific channel | Channel agent plus any mentioned agents |
| Agent, ordinary reply or team update | No automatic agent notification |
| Agent, explicit mentions and valid `reply_to` | Mentioned agents excluding the sender, up to four follow-up hops |

Human workspace members retain shared conversation visibility. Agents receive recent general and their own channel history as context. Context alone does not start a worker turn. Mentioned requests are processed serially by the existing worker, without changing task assignments or approvals.

Selected mentions store stable agent IDs and their original text offsets; changing an agent’s name or role does not retarget an existing mention. Raw API messages can use role tokens such as `@R01` or `@all`. Invalid, archived, disabled-account and cross-project recipients fail validation before any message is stored.

## Agent protocol

`GET /api/agent` returns targeted `messages`, background `context_messages`, an agent directory in `mention_agents`, and `routing_version: 1`. Existing timestamp/ID cursors continue to page targeted requests. Reading a request records Received, not Replied.

Before handling requests, the updated worker posts `{action:"message_delivery", message_ids:[...], status:"responding"}`. A message action includes `reply_to` with the incoming request ID (or an empty string for an unsolicited update). Only a response with a valid inbox parent records Replied. Finishing a turn without a response returns remaining requests to Received. Delivery actions are included in the durable outbox; retrying a message operation does not duplicate messages or recipients.

An agent cannot acknowledge another agent’s delivery. Explicit agent mentions require an inbox parent, exclude self-notification and enforce a four-hop bound. A human can start a new discussion when further follow-up is needed.

## Rollout

After the existing project-management migration 0006, apply `0007_worthless_tempest.sql` before running this server version. It adds mention metadata, per-recipient deliveries and the lookup index, and preserves human requests newer than the recipient’s last check-in under the new PM/direct routing. Old message history remains readable as context. Migrations are additive; do not replay them.

Let existing workers finish their current turn and durable outbox before rollout. Update installed workers using the new script and their existing configuration so the current session ID and cursor are preserved. Older workers still receive targeted messages but do not report Responding or correlated Replied; explicit agent mentions without a reply reference are rejected. No installed worker or live database is modified by this code change.

## Validation

Run `npm run test:mentions` for real SQLite routing, migration, authorization, cursor, idempotency, loop-bound and offline Python worker checks. Run the existing onboarding, token-reset and GitHub integration checks plus TypeScript and a production build. UI browser verification is separate from these offline checks.
