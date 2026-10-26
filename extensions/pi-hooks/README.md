# pi-hooks

Lifecycle hooks for pi: commands that run at session start, before a tool call (and can stop it), and after one (and whose output the model reads). Hooks are configured in a JSON file, so the model can set them up for you.

## Try it

```bash
pi -e ./extensions/pi-hooks
```

## Install

```bash
pi install npm:@hollowheap/pi-hooks
```

## Configure

Hooks live in `<agent-dir>/hooks.json` (default `~/.pi/agent/hooks.json`; the `PI_CODING_AGENT_DIR` environment variable moves the agent directory). A project may add `<project>/.pi/hooks.json`, which is loaded only when the project is trusted. Project hooks run after the agent-directory hooks.

```json
{
  "hooks": {
    "sessionStart": [
      {
        "command": "ai-hooks",
        "args": ["session-start", "--harness", "pi"],
        "timeoutMs": 30000
      }
    ],
    "preTool": [
      {
        "matcher": "bash",
        "command": "check-branch",
        "args": ["--strict"],
        "timeoutMs": 5000
      }
    ],
    "postTool": [{ "matcher": "edit", "command": "npm", "args": ["test", "--silent"] }]
  }
}
```

- `matcher` - the tool name, matched without regard to case, or a name ending in `*` such as `"mcp__*"`. Omit it to match every tool. Tool names are lowercase: `bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`, plus custom tool names. `sessionStart` accepts `matcher` but ignores it.
- `command` - the program to run. It is executed directly, never through a shell, so there is no piping, redirection, or quoting.
- `args` - the arguments, as an array of strings.
- `timeoutMs` - how long the command may run. Defaults to 10000.

A malformed file, an unknown key, or an entry without a `command` is reported and skipped; the other entries still load.

## The protocol

The command receives JSON on stdin. Tool hooks receive the tool call:

```json
{
  "event": "pre_tool",
  "toolName": "bash",
  "toolCallId": "call_1",
  "input": { "command": "ls" },
  "cwd": "/repo",
  "mode": "ask"
}
```

A post-tool hook receives the same fields with `"event": "post_tool"`.

**Pre-tool hooks** let the call through when they print nothing and exit 0, or print `{"decision": "allow"}`. They stop the call when they print `{"decision": "block", "reason": "..."}`, and the reason is shown to the user. Exit code 2 also stops the call, with stderr as the reason. Any other failure - another exit code, a timeout, a missing program - stops the call too, with the failure as the reason: a pre-hook is enforcement, so it fails closed. A pre-hook cannot change the arguments of the call.

**Post-tool hooks** have their stdout appended to the tool result, so the model reads it. A post-hook that fails is reported to the user and leaves the result alone.

**Session-start hooks** receive `{ "event": "session_start", "cwd": "/repo", "mode": "ask" }` on stdin. They are side-effect only: stdout is ignored. A failure is reported as `pi-hooks: <command> failed: <reason>` and startup continues. Hooks run sequentially in configuration order.

## Ordering

`pi-hooks` loads after `pi-guard`, so the permission policy decides first and a tool hook only sees calls the policy allowed. Session-start hooks run once, sequentially, in configuration order. When several tool hooks match, they run in configuration order and the first block wins.

## The skill

`pi-hooks` ships a skill named `hooks-init` that teaches the model the schema, the protocol, and the trust model, so the model can write `hooks.json` for you. Skill discovery via `resources_discover` is disabled by default to avoid prompt bloat and can be enabled by setting `PI_HOOKS_DISCOVER_SKILL=1`.

## Trust

A hook runs a command at session start or on every matching tool call. The project file is honoured in trusted projects; an untrusted project's hooks are ignored. The model can write `hooks.json` with its file tools, and `pi-guard` still gates that write: in `ask` mode it asks first, in `edit` and `autopilot` it does not.

## Notes

- The ACP adapter spawns pi with `-ne`, so user extensions are not loaded there and `pi-hooks` does not affect the ACP path.
- Hook commands run with the process environment and the effective working directory, which follows `/cd`.
