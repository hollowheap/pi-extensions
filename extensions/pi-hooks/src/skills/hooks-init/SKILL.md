---
name: hooks-init
description: Set up pi lifecycle hooks - session-start commands, pre-tool commands that can block a tool call, and post-tool commands whose output is appended to the result. Use when the user asks for hooks, a startup command, a pre-tool check, a command to run after an edit, or to change or remove existing hooks.
---

# Lifecycle hooks

Pi runs commands at session start and around tool calls when `hooks.json` asks it to. You configure hooks by writing that file; there is no separate command to run.

## Where the file lives

- `<agent-dir>/hooks.json` - default `~/.pi/agent/hooks.json`. The `PI_CODING_AGENT_DIR` environment variable moves the agent directory.
- `<project>/.pi/hooks.json` - loaded only when the project is trusted. Hooks from an untrusted project are ignored.

Project hooks run after the agent-directory hooks.

## The format

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
    "postTool": [
      { "matcher": "edit", "command": "npm", "args": ["test", "--silent"] }
    ]
  }
}
```

- `matcher` - the tool name, matched without regard to case, or a name ending in `*` such as `"mcp__*"`. Omit it to match every tool. Tool names are lowercase: `bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`, plus the names of custom tools. `sessionStart` accepts `matcher` but ignores it.
- `command` - the program to run. It is executed directly, never through a shell, so there is no piping, redirection, or quoting.
- `args` - the arguments, as an array of strings.
- `timeoutMs` - how long the command may run. Defaults to 10000.

A malformed entry is reported and skipped; the other entries still load.

## What a session-start hook can do

The command receives this JSON on stdin:

```json
{ "event": "session_start", "cwd": "/repo", "mode": "ask" }
```

Session-start hooks are side-effect only. Stdout is ignored. A failure is reported as `pi-hooks: <command> failed: <reason>` and startup continues. Hooks run sequentially in configuration order.

## What a pre-tool hook can do

The command receives the tool call as JSON on stdin:

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

To let the call through, print nothing and exit 0, or print `{"decision": "allow"}`.

To stop the call, print `{"decision": "block", "reason": "..."}`. The reason is shown to the user.

Exit code 2 also stops the call, with stderr as the reason. Any other failure - another exit code, a timeout, a missing program - stops the call as well, with the failure as the reason. A pre-hook is enforcement, so it fails closed.

A pre-hook cannot change the arguments of the call.

## What a post-tool hook can do

The command receives the tool result as JSON on stdin, with `"event": "post_tool"` and the same `toolName`, `toolCallId`, `input`, `cwd`, and `mode` fields. Its stdout is appended to the tool result, so the model reads it. A post-hook that fails is reported to the user and leaves the result alone.

## Writing the file

Use the write tool to create or update the file. If the file already exists, read it first and change only what the user asked for.

## A note on trust

A hook runs a command at session start or on every matching tool call, and the project file is honoured in trusted projects. Say plainly which command you are adding, and never add a hook the user did not ask for.
