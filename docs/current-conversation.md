# Connect each existing conversation to its role

Use **Current conversation** in `/setup`. The owner can select an unassigned role directly; teammates see only roles assigned to their account. Stop a prior watcher or worker before handing a role to another conversation. The server grants one active controller lease per role.

1. Select the role and provider. Keep **Use my current conversation** selected.
2. Enter the Git root used by that existing conversation. Clone/open the repository there first if needed.
3. Run the setup command in Terminal. It redeems a single-use grant, stores the token privately, and prints the installed relay commands. It does not start a Claude or Codex process or install an AI service.
4. Paste the generated connection prompt into the conversation that should own the role. That session runs `watch` as a background tool.
5. Complete Verify connection. The relay delivers the challenge to the current model, which submits the response. The relay never auto-answers the challenge.
6. Send a unique website message and leave the conversation without typing another prompt. Confirm that this same session receives a background-tool notification, replies on the website, and retains its earlier decisions. Repeat for each role and each host interface.

## Low latency and honest presence

`watch` checks the inbox about every second and exits immediately when a meaningful event arrives. Its tool-completion notification is the wake mechanism. The model handles that event in the existing conversation, acknowledges it, and rearms the watcher in a background tool before continuing longer work. An idle timeout also needs rearming. The relay does not interpret tasks or call a model.

**Session watching** means a relay heartbeat was received. **Session active** means an event was delivered or the controller sent an action. Neither label alone proves that the host app wakes an idle model. The setup challenge and the unique-message test establish that behaviour for the tested interface. The website itself refreshes every five seconds; AI generation time adds to observed reply latency.

Apps differ in their support for background completion notifications. If a host cannot deliver them into an idle conversation, report the limitation and keep manual inbox reads available. Do not claim universal push or create a different model session as a fallback. Closing the app, stopping the watcher, sleeping the computer, or losing the network can stop replies. There is no unattended restart guarantee for a closed Desktop conversation.

## Helper protocol

The configure command prints exact paths and commands. Keep the private `config.json` out of chat, action files, and Git; the helper reads it internally.

| Command | Purpose |
| --- | --- |
| `configure --site HTTPS_ORIGIN --code SINGLE_USE_CODE` | Configure from the wizard without putting a long-lived token in the command |
| `configure --site HTTPS_ORIGIN --workspace GIT_ROOT --agent-id AGENT_ID` | Direct setup using a hidden token prompt |
| `watch --config PATH --timeout 60` | Wait for an event as a background tool in the controlling conversation |
| `inbox --config PATH` | Read/deliver context manually |
| `action --config PATH --file ACTION_JSON` | Submit a message, claim, report, review, proposal, or challenge response under the role’s normal permissions |
| `retry --config PATH` | Resend an uncertain pending action with its original request ID |
| `ack --config PATH` | Acknowledge only the most recently delivered message batch and task snapshot |
| `status --config PATH` | Read server connection health |
| `disconnect --config PATH` | Release this controller’s lease for a handover |

Stop the background watch task before disconnecting, or it may reacquire the lease on its next heartbeat. Do not run two watchers or a separate worker for the same role. Local locking prevents duplicate watchers for one config; server leases reject different controllers across computers. Message deliveries remain pending until ack, and uncertain writes retain their request identity for retry. Do not acknowledge an event with an unresolved action.

The schema addition is `drizzle/0006_romantic_ultragirl.sql`, adding a defaulted connection mode and controller label. Older workers still register as worker mode. No existing Claude PM watcher is changed by a code merge or deployment; each conversation is explicitly connected through the new flow.
