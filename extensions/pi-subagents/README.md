# pi-subagents

Durable child Pi agents for the Pi coding agent. The `subagent` tool starts one child per call, keeps it alive across parent restarts, and lets a later session reattach, send, wait, cancel, or resume it. Agents can come from Markdown files or session-only definitions.

## Try it

```bash
pi -e ./extensions/pi-subagents
```

## Configuration

Create `<agentDir>/subagents.json`:

```json
{
  "maxConcurrent": 4,
  "maxDepth": 1,
  "defaultTimeoutMs": 1800000,
  "writeLockTimeoutMs": 30000,
  "maxSessionAgents": 32,
  "maxSessionAgentBytes": 65536,
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
- `maxSessionAgents`: 1–128, default 32. Maximum session definitions on one branch; redefining an existing name does not count.
- `maxSessionAgentBytes`: 1024–1048576, default 65536. Maximum serialized size of one session definition.
- `harnesses`: optional named generic CLI commands. `input` is `stdin` or `arg`; `arg` appends the prompt unless an argument contains `{prompt}`. `env` adds variables. The optional `transport` field accepts `headless` or `acp` as a label in configuration and run records. Both labels use the configured command and its input setting.

Invalid values diagnose and fall back. The file is optional.

## Read-only transcripts

Run `/subagent view <id>` to see a child's transcript across the terminal.
Bare `/subagent` opens the picker. Alt+Left/Up or Alt+H/K selects the previous
child, and Alt+Right/Down or Alt+L/J selects the next. Escape returns to the
parent prompt.

## Agents

User agents live in `<agentDir>/agents/*.md`. Project agents live in the nearest `<project>/.pi/agents/*.md` and load only when the project is trusted. Project agents override user agents by name.

```markdown
---

name: scout
description: Fast codebase recon
tools: read, grep, find, ls
agents: researcher, worker, code-reviewer
model: provider/model-id:medium
harness: claude
---

You are a read-only scout. Return compressed findings.
```

`tools` and `agents` accept a comma-separated string or a YAML list. `agents` publishes a roster to the child's system prompt as an `<agents>` section:

```text
<agents>
Available subagents. Spawn one with the `subagent` tool using
{ action: "start", agent: "<name>", task: "<task>" }.
- researcher: Deep web research
- worker: Implementation
- code-reviewer: Review and verification
</agents>
```

Names resolve against user, project (when trusted), and session agents; unknown names are skipped with a warning. Children do not load `pi-agent`, so this appended section is the only way they see the roster. Use an optional `<model>:<effort>` suffix to set thinking effort. When omitted, the `thinking` key can set it or the child inherits Pi’s default. The `effort` frontmatter key is ignored. `harness` selects a named entry from `subagents.json`; omitted or `pi` uses the built-in Pi RPC child. Pi children run built-in tools plus headless `@hollowheap/policy` and the child write-lock extension.

### Session definitions

Call `subagent` with action `define` to create an agent that exists only in the current session:

```json
{
  "action": "define",
  "name": "reviewer",
  "description": "Reviews the current diff",
  "systemPrompt": "You review code. Return only actionable findings.",
  "tools": ["read", "grep"],
  "thinking": "high"
}
```

The same fields as Markdown frontmatter are supported. `name` and `systemPrompt` are required; `description` defaults to `Session agent <name>`. The tool stores the definition as a `hollowheap.subagent.definition` custom session entry. It never writes an agent file.

A session definition persists in the session JSONL, restores from the active branch on session start or tree navigation, and shadows a user or project agent with the same name. Start it with the normal `start` action:

```json
{ "action": "start", "agent": "reviewer", "task": "Review the working tree" }
```

Delete a session definition without touching a same-named file agent:

```json
{ "action": "delete", "name": "reviewer" }
```

Deletion appends a tombstone entry, so the definition stays removed when the branch restores. `delete` fails for names that are only file agents. If a file agent has the same name, it becomes visible again after the session definition is deleted.

`maxSessionAgents` and `maxSessionAgentBytes` bound new definitions. Existing definitions already stored in a session remain available when a limit is lowered.

Session definitions are branch-local. Navigating to a branch without the definition removes it from the available set. Defining or deleting an agent does not start a child or ask for shell approval; `start` keeps the normal project-trust and permission checks.

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

| Action   | Input                                                                                                          | Result                                                                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `define` | `name`, `systemPrompt`; optional `description`, `tools`, `model`, `thinking`, `agentMode`, `effort`, `harness` | Stores a session-only agent definition; no file is written.                                                                                                                                                 |
| `delete` | `name`                                                                                                         | Removes a session-only definition; file agents cannot be deleted.                                                                                                                                           |
| `start`  | `agent`, `task`, optional `harness`                                                                           | Starts a file agent or session definition. `harness` can override its default with a configured name or `pi`.                                                                                             |
| `list`   | none                                                                                                           | Summaries of persisted children.                                                                                                                                                                            |
| `status` | `id`                                                                                                           | State plus bounded log output.                                                                                                                                                                              |
| `send`   | `id`, `message`, optional `mode` (`steer`, `prompt`, `follow_up`)                                              | Writes an RPC message to the live child.                                                                                                                                                                    |
| `wait`   | `id`, optional `timeoutMs` (defaults to `defaultTimeoutMs`; `0` waits without a deadline)                      | Waits for a terminal state without taking over the screen: the editor stays usable, so a steering message can be queued while the child runs. Aborting the turn stops waiting without cancelling the child. |
| `cancel` | `id`                                                                                                           | Aborts the child and waits briefly.                                                                                                                                                                         |
| `resume` | `id`                                                                                                           | Restarts a failed child from its session, same id, next attempt.                                                                                                                                            |

`start` and `resume` require a trusted project. The global `maxConcurrent` cap applies per parent session: children from other sessions do not consume the current session's slots. Recursive starts are bounded by `maxDepth`.

## Commands

- `/subagent` opens a fuzzy subagent picker, then the selected child log in a keyboard-scrollable Markdown overlay in TUI mode.
- `/subagent view <id>` opens the child log directly.
- `/subagent pause <id>` aborts the live child.
- `/subagent resume <id>` restarts a failed child.
- `/subagent steer <id> <message>` sends steering text to the live child.

Actions and known subagent IDs support tab completion.

## Durability and state

Each child has a detached runner and a Unix control socket. State lives under `<agentDir>/subagents/`, using the shared `@hollowheap/runtime` store and detached-spawn lifecycle:

- `<id>.json` — state, PID/start time, depth, attempt, harness, optional transport label, input mode, socket, session.
- `<id>.log` — child output.
- `<id>.runner.json` — temporary runner configuration; removed once the socket is ready.
- `<id>.runner.log` — runner errors.
- `<id>.sock` — control socket.
- `<id>.session.jsonl` — Pi session file.

The directory is `0700`; files and sockets are `0600`. The parent can exit and a later session can read the state and connect to the socket. Child processes survive parent exit; there is no central daemon.

Subagent state carries the project folder that started the child. Lists, the picker, statusline counts, todo widgets, completion alerts, and id actions only see children whose recorded folder matches the current working directory. Children from other folders and legacy states without a recorded folder stay hidden.

Lists and the picker label a child by agent, model, and task summary instead of its full id, and show the recorded workspace path. Ids remain the input for `status`, `send`, `wait`, `cancel`, `resume`, and `/subagent view`.

## Write serialization

`write`, `edit`, and `bash` acquire one cross-process lock at `<agentDir>/subagents/write.lock`. The lock stores the owner PID and process start time; stale owners are reclaimed. Read-only tool calls do not acquire it. The child releases the lock on tool result, tool execution end, abort, or a 10-minute safety timeout.

## Recovery

A child that exits non-zero, or whose runner dies, becomes `failed`. `resume` starts a new runner with the same logical id, preserves the saved harness and transport label, increments `attempt`, and sends the saved task again. An isolated child is reallocated in the same `.pi-workspaces/<id>` directory. Pi resumes its saved session; generic harnesses re-run the task without Pi session context. Resume is explicit; there is no auto-resume.

## ACP

When `PI_ACP` is set, `pi-subagents` registers no tool and starts no children. ACP execution stays behind the client terminal and filesystem capabilities.

## Limits

- No worktree isolation; writes serialize instead.
- No central hub daemon.
- No automatic resume.
- No scheduling or missions.
- Children run built-in tools plus headless policy and the lock extension; other suite tools are not loaded.
- Prompts, logs, and results are stored locally under the agent directory.
- Session definitions are not global agents. They exist only in the session branch that created them, never appear in `<agentDir>/agents` or `.pi/agents`, and are bounded by `maxSessionAgents` and `maxSessionAgentBytes`.
