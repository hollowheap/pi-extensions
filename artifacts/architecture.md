# Architecture

Last verified: 2026-11-04.
Scope: `my-pi-agent` workspace.

## System Shape

- Pi loads one extension per `extensions/pi-*` package through jiti with `moduleCache: false`; installed packages get separate module roots.
- `packages/core` owns shared policy, config, shell/exec, formatting, modes, session state, pricing, session caches, and the prompt queue.
- `packages/process` owns detached lifecycle, atomic state, logs, cancellation, PID/start-time reconciliation, and JSONL Unix-socket primitives.
- `packages/pi-acp` is a standalone ACP server plus a bundled extension. It runs one `pi --mode rpc -ne -e <ext> -nbt` child per session and routes execution through client capabilities.
- Durable shell tasks and subagents survive parent exit as detached children. `pi-subagents` uses `pi-tasks` and `packages/process` primitives; ACP keeps subagents inactive.
- Trust boundaries are the project trust gate, agent-dir config, workspace path rules, provider network calls, and the ACP client.

## Module Seams

- `core` is the single policy/config/state owner; consumers keep UI, transport, and adapter behavior.
- `pi-guard` owns verdict prompts, bash truncation, `/mode`, `/context`, and `alt+m`; it does not parse rules.
- `pi-modal` owns the modal editor, mode-themed prompt borders, working indicator, rounded code viewer, vim keybind reference, and the `/expand` tool-output toggle.
- `pi-tools` owns `/cd` only. `pi-language-tools` owns the codemode-only `lang` LSP client and its pooled servers.
- The default active tool set excludes host `powershell` and `ls`; `bash` covers listing and shell work.
- `pi-hooks` owns session/pre/post hook execution and trusted project overlays.
- `pi-question` and `pi-todos` own tagged-block parsing, UI, and branch-local state.
- `pi-tasks` owns durable shell tasks and exports `TaskStore` plus detached-spawn helpers. `pi-subagents` owns child agents, harness selection, write locking, and resume on top of that layer.
- Upstream async subagent runs are mapper-only: a pure mapping feeds the panel; there is no runtime bridge or upstream dependency (D167).
- `pi-web` owns provider adapters and URL safety; `pi-decide` owns the advisory `decide` tool; `pi-agent` owns profile switching and the rounded agent picker/activation popups.
- `pi-usage` owns usage accounting, compaction-safe state, optional USD caps, and the statusline usage provider.
- `pi-acp` adapter owns JSON-RPC framing, session transport, and client capability requests; the bundled extension owns ACP tools and the socket bridge.
- Dependency direction flows from extensions into shared packages. Host modules remain peer-only.

## Dependency Direction

- Dependency direction flows from extensions into shared packages. Host modules remain peer-only.
- Shared packages must not import extension UI or transport code.

## Framework & Library Choices

- Node >= 22.19, npm workspaces, TypeScript loaded by jiti, vitest, and biome.
- Extensions import `@hollowheap/core/*` and `@hollowheap/process/*` subpaths instead of the package barrel. Pi reloads each extension through jiti, so a barrel import re-resolves every shared module and costs about 150 ms per extension; `artifacts/scripts/bench-startup.mjs` measures the full load.
- Pi host modules are peer dependencies; shared runtime packages are real workspace dependencies.
- `packages/pi-acp` builds with `tsc -p packages/pi-acp` into gitignored `dist/`.
- `lang` is a dependency-free LSP client over stdio using Node builtins.
- Codemode uses the host QuickJS surface; web and language tools use it without adding a framework.
- Sandboxing uses system `bwrap`; missing sandbox support fails closed.
- No runtime ACP SDK dependency and no central daemon.

## Data & Contracts

- Agent settings live under `<agentDir>` (`permissions.json`, `modes.json`, `hooks.json`, `subagents.json`, `decide.json`, `language-tools.json`, `modal.json`, `web.json`).
- Trusted project overlays are read only after `ctx.isProjectTrusted()`; untrusted projects are ignored or asked.
- Session state is stored as custom entries: mode, todos, and usage survive resume and compaction.
- Permission rules use `allow|ask|deny`, tag maps, path matching, and a fixed precedence order.
- Web search and fetch return normalized shapes with caps; provider keys come only from environment variables.
- Detached processes persist state atomically, stream logs, and speak one JSON object per line over Unix sockets.
- Task records carry id, kind, status, cwd, timestamps, exit code, output, wait, and cancel. Subagent state adds agent, task, PID, start time, socket, session, attempt, and parent session.
- Usage pricing is per message model; USD caps are optional and cache read/write tokens count.

## Operations & Security

- Project trust gates hooks, project agents, language servers, durable tasks, and project config overlays.
- Permission checks apply at the operation boundary, not only in the UI. Unknown tools ask by default.
- `web_fetch` accepts only `http`/`https`, rejects loopback/private/link-local/metadata targets on every redirect, and caps redirects.
- Detached state directories are `0700`; state, log, session, and socket files are `0600`.
- Dead children reconcile through PID plus process start time to avoid PID reuse.
- The process-wide prompt queue serializes blocking dialogs; nested acquisition is forbidden.
- Shell execution uses core policy; extension-run and background commands wrap with `bwrap` and fail closed when required.
- Built-in `bash` and the whole Pi process are outside the extension sandbox; they require an outer container boundary.
- ACP permission requests correlate to the real tool-call id and reject on client reply, disconnect, child exit, or session close.
- No secrets are written to logs or errors; provider keys are never persisted in `web.json`.

## Known Debt

- DNS-rebinding hardening for `web_fetch` is deferred.
- Todo dependency/cycle behavior remains unported; D156 keeps text blocks and adds selected upstream behaviors without a model tool.
- Durable task cleanup is manual; there is no automatic task garbage collection.
- Subagents do not auto-resume; `resume` is explicit.
- Generic CLI harness usage is unavailable and excluded from usage totals.
- Custom statusline component loading remains deferred.
- ACP live smoke requires an external client and model, so it is not runnable in-repo.

## Non-Goals

- A ctags or tree-sitter fallback engine in v1; the first version is LSP-only.
- Hover, diagnostics, rename, formatting, or code actions in v1.
- Auto-installing language servers or resolving them from project-local `node_modules`.
- Project-level `language-tools.json`; server commands come from built-in mappings and the agent dir only.
- Semantic or embedding-based code search.
- A todo model tool; `pi-todos` uses `create_todos`/`complete_todos` tagged blocks only.
- Rewriting the stored assistant message or model transcript to remove tagged blocks.
- A sidebar or split-pane todo panel; Pi overlays composite without reflowing
  the transcript, and the extension API has no split-pane or side placement.
  Todos use a compact above-editor widget, `/todos`, and the status count.
- A combined tabbed question form; questions are sequential dialogs.
- Stored-message stripping or a tool fallback when no UI is available.
- Removing tagged blocks from RPC client transcripts; RPC rendering is client-owned.
- OS-level sandboxing of allowed shell side effects.
- `tool_search` activation of `fd`/`rg`; a mid-session schema append can invalidate the cached prefix.
- A direct-schema fallback when `codemode` is unavailable; the declared set must not depend on the environment.
- A runtime dependency on the ACP SDK; an ACP SDK in core.
- Sharing core state across processes.
- Changing the permissions rule schema beyond adding a `tools` tag map.
- A central subagent hub daemon; durable children use per-child runners and sockets.
- Local subagent execution under ACP or subagent tool calls routed through the ACP client in v1.
- ACP background terminal tasks; ACP keeps `acp_bash` and the client terminal.
- Completion-triggered model turns for background tasks.
- Local durable task starts in untrusted projects.
- Automatic task garbage collection in v1; durable task cleanup is manual.
- Remote or SSH task execution.
- Codemode-only `task` or `subagent` tools.
- Overriding the host built-in `bash` tool or detaching in-flight foreground commands via `/background` (`alt+b`).
- In-process SDK subagents, worktree isolation, auto-resume, recursive depth beyond 3, or central parent-hub routing.
- Automatic monkey-patching of `ctx.ui` to acquire the prompt lock.
- Serializing non-blocking UI surfaces such as status, widgets, headers, or todo lists.

## Evidence

- Accepted decisions: `artifacts/decisions.md` D01-D169.
- Behavioral specs: `artifacts/specs.md` (167 entries, S01-S169; S139-S140 absent).
- Historical spec prose: `artifacts/research/spec-prose-archive.md`.
- Runtime map and commands: `artifacts/context.md`.
- Requirements: `artifacts/requirements.md`.
- Final suite (982 tests/108 files), typecheck, and lint (299 files) green on 2026-11-04.
