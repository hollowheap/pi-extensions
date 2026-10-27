# pi-subagents

Durable child Pi agents for the Pi coding agent. The `subagent` tool starts one child per call, keeps it alive across parent restarts, and lets a later session reattach, send, wait, cancel, or resume it.

## Try it

```bash
pi -e ./extensions/pi-subagents
```

## Install

```bash
pi install npm:@hollowheap/pi-subagents
```

## Configuration

Create `<agentDir>/subagents.json`:

```json
{
  "maxConcurrent": 4,
  "maxDepth": 1,
  "defaultTimeoutMs": 1800000,
  "writeLockTimeoutMs": 30000
}
```

- `maxConcurrent`: 1–8, default 4.
- `maxDepth`: 1–3, default 1. Children cannot recurse beyond this depth.
- `defaultTimeoutMs`: default 30 minutes; `0` disables; max 24 hours.
- `writeLockTimeoutMs`: 1–300000, default 30 seconds.

Invalid values diagnose and fall back. The file is optional.

## Agents

User agents live in `<agentDir>/agents/*.md`. Project agents live in the nearest `<project>/.pi/agents/*.md` and load only when the project is trusted. Project agents override user agents by name.

```markdown
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls
model: provider/model-id
thinking: medium
---
You are a read-only scout. Return compressed findings.
```

`tools` accepts a comma-separated string or a YAML list. `model` and `thinking` are optional; omitted values inherit Pi’s defaults. Children run Pi’s built-in tools plus `pi-guard` and the child write-lock extension.

## Agent selection

The `/agent` slash command switches the active main session persona:

- `/agent` — opens an interactive selector (`ctx.ui.select`) of available user and project agents, plus a `(default)` reset option.
- `/agent <name>` — activates agent `<name>` directly (with tab completion).
- `/agent default` (or `reset`) — restores the default persona, clears agent status, and restores tools.

When switched, the active session adopts the agent's system prompt persona, model, guard mode (`plan`/`ask`), thinking effort, and active tools. The selection persists across turns and restores on session start.

## Tool

`subagent` is a direct tool. One child per `start`; callers can start multiple children up to `maxConcurrent`.

| Action | Input | Result |
| --- | --- | --- |
| `start` | `agent`, `task` | Starts a child and sends the task prompt. |
| `list` | none | Summaries of persisted children. |
| `status` | `id` | State plus bounded log output. |
| `send` | `id`, `message`, optional `mode` (`steer`, `prompt`, `follow_up`) | Writes an RPC message to the live child. |
| `wait` | `id`, optional `timeoutMs` | Waits for a terminal state. |
| `cancel` | `id` | Aborts the child and waits briefly. |
| `resume` | `id` | Restarts a failed child from its session, same id, next attempt. |

`start` and `resume` require a trusted project. Concurrent starts are bounded by `maxConcurrent`; recursive starts are bounded by `maxDepth`.

## Durability and state

Each child has a detached runner and a Unix control socket. State lives under `<agentDir>/subagents/`:

- `<id>.json` — state, PID/start time, depth, attempt, socket, session.
- `<id>.log` — child output.
- `<id>.runner.json` — runner configuration.
- `<id>.runner.log` — runner errors.
- `<id>.sock` — control socket.
- `<id>.session.jsonl` — Pi session file.

The directory is `0700`; files and sockets are `0600`. The parent can exit and a later session can read the state and connect to the socket. Child processes survive parent exit; there is no central daemon.

## Write serialization

`write`, `edit`, and `bash` acquire one cross-process lock at `<agentDir>/subagents/write.lock`. The lock stores the owner PID and process start time; stale owners are reclaimed. Read-only tool calls do not acquire it. The child releases the lock on tool result, abort, or a 10-minute safety timeout.

## Recovery

A child that exits non-zero, or whose runner dies, becomes `failed`. `resume` starts a new runner with the same logical id, persists the session path, increments `attempt`, and sends the saved task again. Resume is explicit; there is no auto-resume.

## ACP

When `PI_ACP` is set, `pi-subagents` registers no tool and starts no children. ACP execution stays behind the client terminal and filesystem capabilities.

## Limits

- No worktree isolation; writes serialize instead.
- No central hub daemon.
- No automatic resume.
- No scheduling or missions.
- Children run built-in tools plus `pi-guard` and the lock extension; other suite tools are not loaded.
- Prompts, logs, and results are stored locally under the agent directory.
