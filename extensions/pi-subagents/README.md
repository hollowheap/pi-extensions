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
  "writeLockTimeoutMs": 30000,
  "harnesses": {
    "claude": {
      "command": "claude",
      "args": ["-p"],
      "input": "stdin"
    },
    "codex": {
      "command": "codex",
      "args": ["exec"],
      "input": "arg"
    }
  }
}
```

- `maxConcurrent`: 1–8, default 4.
- `maxDepth`: 1–3, default 1. Children cannot recurse beyond this depth.
- `defaultTimeoutMs`: default 30 minutes; `0` disables; max 24 hours.
- `writeLockTimeoutMs`: 1–300000, default 30 seconds.
- `harnesses`: optional named generic CLI commands. `input` is `stdin` or `arg`; `arg` appends the prompt unless an argument contains `{prompt}`. `env` adds variables.

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
harness: claude
---
You are a read-only scout. Return compressed findings.
```

`tools` accepts a comma-separated string or a YAML list. `model` and `thinking` are optional; omitted values inherit Pi’s defaults. `harness` selects a named entry from `subagents.json`; omitted or `pi` uses the built-in Pi RPC child. Pi children run built-in tools plus headless `@hollowheap/policy` and the child write-lock extension.

## Harnesses

The default `pi` harness speaks JSONL RPC, so steering, session continuation, write locking, and guard policy work as described below. A generic harness runs an external CLI instead:

- The system prompt and task are sent together as plain text.
- `input: "stdin"` writes the prompt to stdin; `input: "arg"` adds it to the command arguments.
- Steering writes raw text to stdin. It is best-effort because external CLIs may not accept input while running.
- Output, wait, cancel, and resume still use the task/state lifecycle.
- Generic harnesses do not load the headless policy, the write lock, or the Pi session; resume re-runs the saved task without continuing Pi session context.
- `message` steering is normalized to text for these harnesses.


## Tool

`subagent` is a direct tool. One child per `start`; callers can start multiple children up to `maxConcurrent`.

| Action | Input | Result |
| --- | --- | --- |
| `start` | `agent`, `task` | Starts a child and sends the task prompt. |
| `list` | none | Summaries of persisted children. |
| `status` | `id` | State plus bounded log output. |
| `send` | `id`, `message`, optional `mode` (`steer`, `prompt`, `follow_up`) | Writes an RPC message to the live child. |
| `wait` | `id`, optional `timeoutMs` | Waits for a terminal state; TUI sessions show a cancellable loader, and Escape stops waiting without cancelling the child. |
| `cancel` | `id` | Aborts the child and waits briefly. |
| `resume` | `id` | Restarts a failed child from its session, same id, next attempt. |

`start` and `resume` require a trusted project. Concurrent starts are bounded by `maxConcurrent`; recursive starts are bounded by `maxDepth`.

## Commands

- `/subagent` opens a fuzzy subagent picker, then the selected child log in a keyboard-scrollable Markdown overlay in TUI mode.
- `/subagent logs <id>` opens the child log directly.
- `/subagent pause <id>` aborts the live child.
- `/subagent resume <id>` restarts a failed child.
- `/subagent steer <id> <message>` sends steering text to the live child.

Actions and known subagent IDs support tab completion.

## Durability and state

Each child has a detached runner and a Unix control socket. State lives under `<agentDir>/subagents/`, using the shared `@hollowheap/process` store and detached-spawn lifecycle:

- `<id>.json` — state, PID/start time, depth, attempt, harness, input mode, socket, session.
- `<id>.log` — child output.
- `<id>.runner.json` — temporary runner configuration; removed once the socket is ready.
- `<id>.runner.log` — runner errors.
- `<id>.sock` — control socket.
- `<id>.session.jsonl` — Pi session file.

The directory is `0700`; files and sockets are `0600`. The parent can exit and a later session can read the state and connect to the socket. Child processes survive parent exit; there is no central daemon.

## Write serialization

`write`, `edit`, and `bash` acquire one cross-process lock at `<agentDir>/subagents/write.lock`. The lock stores the owner PID and process start time; stale owners are reclaimed. Read-only tool calls do not acquire it. The child releases the lock on tool result, tool execution end, abort, or a 10-minute safety timeout.

## Recovery

A child that exits non-zero, or whose runner dies, becomes `failed`. `resume` starts a new runner with the same logical id, preserves the saved harness, increments `attempt`, and sends the saved task again. Pi resumes its saved session; generic harnesses re-run the task without Pi session context. Resume is explicit; there is no auto-resume.

## ACP

When `PI_ACP` is set, `pi-subagents` registers no tool and starts no children. ACP execution stays behind the client terminal and filesystem capabilities.

## Limits

- No worktree isolation; writes serialize instead.
- No central hub daemon.
- No automatic resume.
- No scheduling or missions.
- Children run built-in tools plus headless policy and the lock extension; other suite tools are not loaded.
- Prompts, logs, and results are stored locally under the agent directory.
