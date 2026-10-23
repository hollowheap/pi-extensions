# Specs and interface contracts

Living record of cross-package contracts. One section per spec; each section states the contract, the anchors, and its resolutions.

## Spec: core runtime foundation (resolved 2026-10-21; supersedes the pi-acp enforcement spec below)

Decision source: the architectural correction set of 2026-10-21. Implementation: T01-T18 in `artifacts/plan.md`. Supersedes `guard:*` query/command envelopes as the cross-package coordination mechanism.

### 1. Package boundary and loading

- `@hollowheap/core` gains a runtime entry: `src/index.ts` exports `types.ts` plus `policy.ts`, `config.ts`, `shell.ts`, `exec.ts`, `format.ts`, `state.ts`, `modes.ts`.
- Core imports no `@earendil-works/*` and no `typebox` (not even as peers); it is dependency-free at runtime.
- Consumers (pi-guard, pi-tools, pi-budgets, pi-autopilot, pi-acp) list it in `dependencies` at `^0.2.0`, not `devDependencies`. Core moves to `0.2.0` for the breaking API change.
- pi's loader creates a fresh jiti per extension load with `moduleCache: false` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:477-481`), pi installs package `dependencies` with the source (`docs/packages.md:78`), and installed packages load with separate module roots (`docs/packages.md:92`). One core version can therefore be evaluated more than once per process. All shared state lives on a process-global registry `globalThis[Symbol.for("@hollowheap/core/state")]`, never in module-level variables.
- `@hollowheap/core` becomes the single documented exception to the no-bare-imports rule (`AGENTS.md:4`); every other bare import stays banned for extension code.

### 2. Permission engine

```ts
export type Tag = "edit" | "read" | "search" | "shell";
export type Effect = "allow" | "ask" | "deny";        // widened from allow|deny
export type Verdict = Effect;
export interface Rule { tag: Tag; pattern: string; effect: Effect }
```

Precedence is a fixed ladder; array order never decides (replaces `packages/pi-guard/src/rules.ts:83-97`):

1. **Hard safety invariants → `deny`.** Target outside the realpath'd workspace root; empty shell command; dangerous executables/interpreters (`sh bash zsh dash fish eval xargs env sudo tee dd awk perl python node` and `sh -c`-style wrappers); output/input redirects; command substitution `$(...)`/backticks; process substitution `<(...)`/`>(...)`.
2. **Explicit `deny` rules** matching the call, from the merged rule set (`<agentDir>/permissions.json` plus a trusted project overlay), beat everything below, including plan-path allowances and mode overrides.
3. **Active mode overrides** (restrictive rules only, e.g. plan clamping `edit`).
4. **Merged `allow`/`ask` rules** resolve by highest pattern specificity (literal characters after stripping `*`/`?`); ties favor the stricter effect (`deny > ask > allow`).
5. **Active mode defaults** for the tag when no rule matched.

Shell rules match command prefixes on token boundaries: rule `git` matches `git status`, never `github-cli`. Shell chains split on `\n`, `&`, `&&`, `||`, `;`, `|`; every part is analysed independently and the call takes the strictest part result.

### 3. Modes as declarative layers

```ts
export interface ModeLayer {
  name: string;
  defaults: Record<Tag, Effect>;
  overrides?: Rule[];                         // restrictive: ask/deny only
  onEnter?: (owner: unknown) => { veto?: string; notice?: ModeNotice } | undefined;
}
```

| Layer | read/search | edit | shell | overrides |
| --- | --- | --- | --- | --- |
| `ask` (built-in default) | allow | ask | ask | — |
| `edit` (built-in) | allow | allow | ask | — |
| `plan` (built-in) | allow | deny | ask | `edit` → ask on `artifacts/plan.md`, `artifacts/specs.md`, `artifacts/tasks/**` (effective cwd, D33); `edit` → deny elsewhere |
| `autopilot` (pi-autopilot) | allow | allow | allow | — (entry gated by pi-budgets) |

The `ask`/`edit`/`plan` layers live in core; `autopilot` registers at extension load; user layers come from `<agentDir>/modes.json`. Registration is first-wins per name, with a diagnostic on duplicates. Entry runs gates in registration order; the first `veto` blocks the switch and every `notice` surfaces to the user. The procedural `apply` callbacks and `ModeApplyDetails.inPlanPaths` (`packages/core/src/types.ts:11-29`) are deleted.

#### Config-defined layers (`<agentDir>/modes.json`)

The agent dir comes from `getAgentDir()` (default `~/.pi/agent/`), matching `statusline.json`/`dashboard.json` (`packages/pi-statusline/src/config.ts:46`, `packages/pi-dashboard/src/config.ts:4`). Schema:

```json
{
  "modes": {
    "readonly": {
      "defaults": { "read": "allow", "search": "allow", "edit": "deny", "shell": "deny" },
      "overrides": [{ "tag": "edit", "pattern": "docs/**", "effect": "ask" }]
    }
  }
}
```

- `defaults` must cover all four tags; missing tags are a diagnostic and the layer is dropped.
- `overrides` accept only `ask`/`deny`; `allow` overrides are a diagnostic and are ignored.
- Names colliding with built-in or package layers are rejected with a diagnostic (config cannot redefine `ask`/`plan`/`autopilot`).
- `loadModesConfig(agentDir, onDiagnostic?)` is mtime-cached like `loadPermissions`; diagnostics fire once per change.
- Config layers carry `source: "config"` and are replaced wholesale on each session start; built-in and package layers persist in the registry. Duplicate config names: first wins, later one diagnosed.

### 4. Session state and registry

- `session(owner)` returns `{ mode, cwd }`; `setMode`, `effectiveCwd`, `resetSession`, `dropSession` operate on the global registry keyed by the pi session owner. Default mode is `ask`; clearing cwd restores `ctx.cwd`.
- Persistence: the active mode is appended to the session as `appendCustomEntry("hollowheap.core.mode", { mode })` (`session-manager.d.ts:273`) whenever it changes; `resetSession` re-reads `getEntries()` (custom entries do not enter LLM context) and restores the last known mode, so resume and fork keep it. A restored mode that no longer exists (config removed) falls back to `ask` with a diagnostic, and restored modes re-run entry gates (veto → `ask`). Core takes a structural `SessionLike { getEntries?; appendCustomEntry? }`, never pi types.
- Modes replace `guard:modes`/`guard:mode-enter` (`packages/pi-guard/src/index.ts:32-33,109-147`) and cwd replaces `guard:cwd-query`/`guard:cwd-set` (`packages/pi-tools/src/cwd.ts:1-25`); those channels and their envelopes are deleted.
- One process holds one ACP session or one TUI session, so a single registry is correct; no cross-process state.

### 5. Shared primitives

- `runBinary(command, args, cwd, signal, opts?)`: bounded stdout (`maxBuffer`), abort signal, `okExitCodes`, `ENOENT` → `command not found: <name>` after checking cwd existence. Replaces the behaviour in `pi-tools/src/exec.ts`, `pi-acp/src/extension/exec.ts`, `pi-dashboard/src/exec.ts`.
- `loadPermissions({ agentDir, workspaceRoot, trusted, onDiagnostic? })`: mtime-cached `<agentDir>/permissions.json` plus `.pi/permissions.json` only when `trusted`; parse diagnostics once per change (replaces `pi-guard/src/loader.ts:79-121`). `loadModesConfig(agentDir, onDiagnostic?)` uses the same cache/diagnostic machinery for `<agentDir>/modes.json`.
- `truncateText(text)` (4000-char threshold, 3000 head + 1000 tail) and `displayTarget(text)` (500-char ellipsis) replace the copies in guard/acp tools.

### 6. Consumer invariants

- **pi-guard (TUI)**: keeps only the `tool_call` hook (query core for the verdict, prompt via `ctx.ui.confirm` on `ask`, block on `deny`), bash result truncation, `/mode`, `alt+m`, and the `mode-guard` statusline value. Deletes `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts`.
- **pi-autopilot**: registers the `autopilot` layer; no `guard:modes` listener.
- **pi-budgets**: registers the autopilot entry gate (no cap → veto, "autopilot refused: set a token cap first"); keeps usage accumulation and the `before_agent_start` cap abort; no `guard:mode-enter` listener.
- **pi-tools**: `/cd` reads/writes the core session cwd so it works without pi-guard; `fd`/`rg` keep results whose verdict is not `deny` (an `ask` path is not dropped); `fd` args become `["--glob", pattern, "--", dir]`, `rg` passes the pattern via `--regexp` and terminates with `--`. Deletes `rules.ts`, `loader.ts`.
- **pi-statusline/pi-dashboard**: UI-only; both read `effectiveCwd(ctx.cwd, owner)` for their cwd segment.

### 7. pi-acp protocol, lifecycle, and tools

- The bundled extension imports `@hollowheap/core`; it deletes `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts`, `exec.ts`, and `decide()`. Its `tool_call` hook evaluates core for the `acp_*` tools (built-ins are disabled, below) and asks the adapter over the socket on `ask`; disconnected → `deny`.
- Spawn adds `-nbt` (`pi --help` line 36: "Disable built-in tools by default but keep extension/custom tools enabled") so `read/write/edit/bash` cannot run behind the ACP client. `-ne -e <extension>` stays.
- Lifecycle: `loadSession`/`newSession` close any existing live session (kill child, close server, destroy sockets, unlink path) before spawning, and on any startup-validation failure; prompt completion handlers are registered before dispatching `prompt` (`adapter.ts:795-801` registers after the await today); child exit/error and session close reject all pending prompts, permission requests, and client RPCs; the active mode is pushed to the extension on every connect/reconnect, and mode changes requested before the handshake completes are buffered and applied.
- Protocol: `session/request_permission` carries the real pi tool-call id (today `acp-${toolSeq}`, `adapter.ts:576-581`); `terminal/output` polling is bounded by a wall-clock timeout in addition to per-request timeouts (`extension/tools.ts:217-241` loops forever); timed-out client RPCs delete their pending entry (outer `withTimeout`, `client-requests.ts:40-56`, leaves the inner entry without a timer).
- Tools: `acp_write` creates missing parent directories and still refuses existing paths; `acp_edit` keeps the buffer-vs-disk refusal and errors clearly on a missing file; `acp_fd` uses `--glob … --`; `acp_rg` uses `--regexp … --`; `acp_eza` verifies `isDirectory()`; unused helpers that fail `noUnusedLocals` are removed.
- Approval: `session/request_permission` offers exactly `allow_once`/`reject_once`; deny never reaches the client; no client or disconnect → block with a reason.
- Mode list: the extension owns the mode registry, so the adapter asks it for the modes (`get-modes` over the socket) and offers every registered mode to the client as a config option. A mode contributed by an extension (`autopilot`) is therefore selectable, and `session/set_config_option` accepts it. The adapter falls back to its built-in `plan`/`ask`/`edit` list when the extension does not answer.
- Mode notices: a notice produced while entering a mode rides in the returned mode config option's description, so the client renders it without a separate channel. A veto blocks the switch, and the refusal travels as the `set_config` error.

### 8. Non-goals

OS-level sandboxing of allowed shell side effects; an ACP SDK runtime dependency; sharing state across processes; changing the permission file format beyond the widened effect enum.

### 9. Acceptance

- `rg -n "function check\\(|globToRegExp|checkBash|loadRules|modeOwners|overrideDirs" packages/*/src` finds implementations only under `packages/core/src`.
- Mode matrix and precedence ladder covered by table-driven core tests; consumer tests assert delegation, not duplicated policy.
- Persistence: switching mode then resuming or forking restores it; a removed mode restores to `ask`; a restored `autopilot` without a cap is vetoed back to `ask`.
- `<agentDir>/modes.json`: a valid custom layer evaluates; a colliding name, an `allow` override, or a missing tag is diagnosed and ignored/dropped.
- pi-acp tests assert `-nbt` in spawned args, real tool ids in permission requests, and teardown on load failure.
- `npm test`, `npm run typecheck`, `npm run lint`, `npx tsc -p packages/pi-acp` green; live ACP smoke shows one permission prompt with the client's tool-call id.

## Spec: pi-acp consumes pi-guard enforcement (superseded 2026-10-21 by the core runtime foundation)

> Historical. Its `guard:tool-tags`/`guard:mode-set` envelopes and the spawn-without-guard fallback are replaced by the section above; do not implement A15-A24.

## Spec: pi-hooks, model-configurable tool hooks (resolved 2026-10-22)

Decision source: D35-D41. Implementation: T21-T26 in `artifacts/tasks/plan.md`. A new `pi-hooks` extension turns a JSON config into pi's existing `tool_call` and `tool_result` events, so the model can install its own pre-tool and post-tool commands.

### 1. Package boundary

- `packages/pi-hooks/` is a new `pi.extensions` package: entry `src/index.ts`, declared in the root `package.json` `pi.extensions` list **after** `pi-guard`, so the core policy decides first and pi-hooks only sees calls the policy allowed.
- It depends on `@hollowheap/core` at `^0.2.0` for the effective cwd (`effectiveCwd`), the active mode (`session`), and `truncateText`.
- Core gains `runCapture(command, args, cwd, signal, opts?)` in `exec.ts`: optional stdin, and it resolves `{ code, stdout, stderr }` instead of throwing on a non-zero exit. The hook protocol needs the exit code and stderr as values, which `runBinary` discards; adding a second subprocess implementation in a consumer is the duplication D05 forbids.
- pi-hooks owns its config loader. `hooks.json` has exactly one reader, so a per-instance mtime cache is enough; core's shared globalThis cache exists because `permissions.json` is read by three packages.

### 2. Configuration

- `<agentDir>/hooks.json` (default `~/.pi/agent/hooks.json`) always. The name does not collide with pi's deprecated `hooks/` directory, which pi warns about (`dist/migrations.js:199-209`).
- `<project>/.pi/hooks.json` only when `ctx.isProjectTrusted()`; an untrusted project overlay is ignored with a once-per-change diagnostic, and the agent-dir hooks still apply.
- Both files may appear; project hooks run after the agent-dir hooks.

```json
{
  "hooks": {
    "preTool": [
      { "matcher": "Bash", "command": "check-branch", "args": ["--strict"], "timeoutMs": 5000 }
    ],
    "postTool": [
      { "matcher": "Edit", "command": "npm", "args": ["test", "--silent"] }
    ]
  }
}
```

- `matcher`: the tool name, matched without regard to case, or a trailing `*` prefix (`"mcp__*"`); omitted or `"*"` matches every tool. A `*` anywhere but the end is a diagnostic.
- `command`: the program to run. `args`: an optional string array. The command is executed directly, never through a shell, so there is no quoting, glob, or redirection syntax to get wrong.
- `timeoutMs`: optional, default 10000.
- A malformed file, an unknown key, a missing `command`, or a bad `matcher` is a diagnostic. The offending hook is ignored and the rest still load; a malformed file yields no hooks at all.

### 3. Execution protocol

The command runs with the tool call JSON on stdin, in the effective cwd, with the process environment:

```json
{ "event": "pre_tool", "toolName": "bash", "toolCallId": "call_1", "input": { "command": "ls" }, "cwd": "/repo", "mode": "ask" }
```

The pre-hook verdict, in order:

1. stdout parsed as JSON: `{"decision":"block","reason":"..."}` blocks the call, `{"decision":"allow"}` passes it.
2. empty stdout with exit code 0 passes.
3. exit code 2 blocks, with stderr as the reason.
4. any other outcome — a non-zero exit, a timeout, a spawn failure — blocks the call with the failure as the reason (D40).

A post-hook's stdout is appended to the tool result as a text block, truncated with core's `truncateText`. A post-hook failure is logged and does not change the result: the call already ran, so failing closed is not available.

### 4. Event wiring

- `tool_call`: the matching pre-hooks run in config order; the first block wins and stops the chain.
- `tool_result`: the matching post-hooks run in config order; each output is appended.
- pi-hooks never mutates `event.input` and never replaces result content, only appends (D37, D38).

### 5. The default skill

- The skill lives at `packages/pi-hooks/src/skills/hooks-init/SKILL.md` and is contributed with `pi.on("resources_discover", () => ({ skillPaths: [<absolute path>] }))` (D41). It is deliberately not under the package's conventional `skills/` root, so it is never discovered twice.
- pi advertises a skill by name, description, and path, and the model reads the file itself (`dist/core/skills.js:283-302`). The description is therefore the routing signal and must name hooks explicitly. The model cannot emit `/skill:hooks-init` itself, since that expansion happens only on the user-input path (`dist/core/agent-session.js:1697`).
- The skill body teaches the file locations, the schema, the verdict protocol, and the trust consequence of writing `hooks.json`.

### 6. Trust and scope

- The ACP adapter spawns pi with `-ne`, so user extensions are not loaded there and pi-hooks does not affect the ACP path.
- A project hooks file runs commands only in a trusted project.
- The model installs hooks by writing `hooks.json` with its own file tools. pi-guard still gates that write: in `ask` mode it asks first, in `edit` and `autopilot` it does not. That is the accepted cost of the skill-only model surface (D39).

### 7. Acceptance

- `rg -n "execFile|spawn\\(" packages/pi-hooks/src` finds no subprocess call: the runner is core's.
- Core tests cover `runCapture` (stdin, exit code, stderr, no throw on a non-zero exit).
- pi-hooks tests cover config parsing and diagnostics, the matcher, the wiring (a pre-hook blocks, a post-hook appends), the fail-closed path, and that `resources_discover` returns the skill path.
- The skill's frontmatter is valid and its body states the schema.

## Spec: tool-free question blocks (pending 2026-10-22)

Decision source: D44-D53. Implementation: pending in `artifacts/plan.md`. The contract replaces the `question` tool with tagged fenced blocks in assistant text and a core-owned scanner that future todo handlers can reuse.

### 1. Package boundary

- `packages/pi-question` remains a pi extension, but it registers no model tool. It wires `message_end`, `before_agent_start`, `registerMarkdownTransformer`, and `registerMessageRenderer`.
- It adds `@hollowheap/core` at `^0.2.0` in `dependencies`. It removes `typebox`, `@earendil-works/pi-ai`, and `@earendil-works/pi-agent-core` from its peer dependencies. It keeps `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.
- `@hollowheap/core` gains `src/blocks.ts`, exported from `src/index.ts`. Core imports no `@earendil-works/*` and no `typebox`, and adds no runtime dependency.
- No package version changes in this task (D51). The root `pi.extensions` list still includes `pi-question`.

### 2. Tagged block scanner (core)

```ts
export interface TaggedBlock {
  tag: string;
  body: string;
  start: number;
  end: number;
  closed: boolean;
}

export function scanTaggedBlocks(markdown: string): TaggedBlock[];
```

- An opening line is `'''` immediately followed by a tag matching `[a-z][a-z0-9_]*`, with optional trailing spaces. A closing line is `'''` with optional trailing spaces.
- Blocks may be multiple, empty-bodied, or unclosed at EOF (`closed: false`). `start` and `end` cover the opening line through the closing line, or through EOF when unclosed, so callers can remove the whole block.
- Lines inside markdown fenced code blocks (` ``` ` or `~~~`) are ignored, so a prose example is not a tagged block.
- Malformed input never throws.

### 3. Minimal markdown AST (core)

```ts
export type MarkdownNode = HeadingNode | ListNode | ParagraphNode;

export interface HeadingNode { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; text: string }
export interface ListNode { type: "list"; ordered: boolean; items: ListItemNode[] }
export interface ListItemNode { type: "listItem"; text: string; checked?: boolean }
export interface ParagraphNode { type: "paragraph"; text: string }

export function parseMarkdownBlocks(body: string): MarkdownNode[];
```

- Headings use `#` through `######`; list markers are `-`, `*`, `+`, or `1.`/`1)`; list items may start with `[ ]` or `[x]`, which sets `checked` to `false` or `true`.
- A paragraph node groups consecutive non-empty, non-heading, non-list lines, joined with single spaces, without inline-markdown parsing. Nested lists are not required.
- Malformed input never throws.

### 4. Question block contract

- A question body uses one H2 per question. H1 and H3+ headings are ignored. A block with no H2 is invalid.
- Each question reads ordered list items as options; an unordered list inside a question is invalid.
- If every option starts with `[ ]` or `[x]`, the question is multi-select. If none do, it is single-select. A mix is invalid. `[x]` means "multi marker", not a pre-selected option.
- A question has 0-8 options. Zero options is a free-text question. Nine or more options is invalid. Empty option text is invalid.
- The model must not write a write-in option. An option equal to the reserved label `Write-in answer` makes the block invalid; the UI always appends that final row.
- Multiple H2 questions and multiple `question` fences preserve source order. A block with any invalid question is invalid as a whole.
- A valid block asks every question sequentially; an invalid block opens no dialogs and remains visible.

### 5. Message hook and lifecycle

- On `message_end` with an assistant message, inspect its text content blocks and parse every `question` block. Do not treat user or thinking content as questions.
- If a message contains valid and invalid blocks, ask the valid questions and leave the invalid blocks visible.
- Ask all valid questions in source order. If any dialog is cancelled, cancel the whole set, send no follow-up, and do not throw.
- Only a live `message_end` opens dialogs. Resumed or replayed assistant messages are not re-asked; the display transformer still hides valid blocks.
- The hook never replaces the assistant message. The raw fence remains in agent state, persistence, and model context.

### 6. Dialogs

- TUI single-select: `ctx.ui.select` with the option labels plus the final `Write-in answer` row. Selecting a normal row records it; selecting the write-in row calls `ctx.ui.input`. The write-in is capped at 500 characters.
- TUI multi-select: `ctx.ui.custom` renders checkbox rows with the final write-in row. Space toggles a row, entering the write-in row opens an inline editor, and Enter on the Done row submits. Zero selected rows is valid.
- RPC single-select: the same `select` plus `input` flow as TUI.
- RPC multi-select: a `ctx.ui.select` loop renders `[ ]`/`[x]` rows plus the write-in row and a Done control. Each call toggles one row or opens `input` for the write-in; Done completes. Zero selected rows is valid.
- If `ctx.ui.custom` is unavailable, the select-loop is the fallback.
- A free-text question (zero options) uses `ctx.ui.input` in both modes. An empty string is a valid answer; cancellation cancels the whole set.
- `ctx.mode === "tui"` selects the custom multi-select component; `ctx.mode === "rpc"` uses the select-loop. Print/json open no dialogs.
- Questions are sequential; there is no combined tabbed form.

### 7. System prompt section

- A `before_agent_start` handler adds `event.systemPromptOptions.sections.question_format` only when `ctx.hasUI` is true. The key is stable, and the handler does not return or force a system prompt.
- The section teaches: the exact `'''question` fence; one H2 per question; ordered-list options; `[ ]` on every option for multi-select; no checkbox for single-select; 0-8 options; the UI supplies the write-in; end the turn without tool calls; answers arrive as a follow-up user message; use questions only when the code or request cannot decide.
- Print/json get no section, so the model never sees a question contract it cannot answer.

### 8. Display transformer

- `registerMarkdownTransformer` removes valid `question` blocks only when `context.messageType === "assistant"`.
- It removes a fully closed valid block, and it removes an open question fence from its opening line through the end of the current markdown while `context.isStreaming` is true to avoid a partial flash.
- It leaves unknown tags, fully closed invalid question blocks, and non-assistant messages untouched. It ignores markdown fenced code blocks.
- It never mutates the stored message. RPC clients still receive the raw fence; RPC rendering is client-owned (non-goal).
- Removing a block may leave the assistant message empty; that is acceptable.

### 9. Answers

- After all questions are answered, send one `pi.sendMessage` with `customType: "hollowheap.question.answers"`, `display: true`, and `deliverAs: "followUp"`. The host converts the custom message to a user-role message; no tool result is created.
- `content` lists numbered answers only, in source order, with no question text:
  - single-select: the selected label or write-in text;
  - multi-select: selected labels joined by `, `, with `Write-in: <text>` appended when present, or `none selected` when empty;
  - free text: the input text, or `no answer` when empty.
- `details` carries `{ questions, answers }` for the renderer.
- `registerMessageRenderer("hollowheap.question.answers", ...)` renders a compact numbered answer list. It falls back to the content text when details are missing and never throws.
- Cancellation sends no message.

### 10. Documentation and acceptance

- `packages/pi-question/README.md` documents: no tool, the fence syntax, sequential TUI/RPC dialogs, the implicit write-in row, display-only TUI stripping, the RPC raw-fence limitation, silent cancellation, and the breaking removal.
- Tests cover scanner/AST edge cases, question parsing, TUI single/multi flows, RPC select-loop, system-prompt gating, display stripping, answer delivery, cancellation, and malformed blocks.
- `npm test`, `npm run typecheck`, and `npm run lint` stay green.

## Specification index (to-task input)

Traceable behavioral specs. Prose above carries rationale and anchors; this list is the executable contract.

- [x] S01 [D01]: `@hollowheap/core` exports the only policy engine (`evaluate`, `loadPermissions`, `checkPath`, `checkShell`); no consumer ships rule parsing or shell analysis | Verify: `npx vitest run packages/core/src/policy.test.ts`
- [x] S02 [D02]: core exports `session(owner)`, `setMode`, `effectiveCwd`, `resetSession`, `dropSession`; mode/cwd reads never traverse pi events | Verify: `npx vitest run packages/core/src/state.test.ts`
- [x] S03 [D03]: state lives on `globalThis[Symbol.for("@hollowheap/core/state")]`; two independent module loads observe the same registry | Verify: `npx vitest run packages/core/src/state.test.ts`
- [x] S04 [D04]: consumers declare `@hollowheap/core` in `dependencies` at `^0.2.0`; core imports no `@earendil-works/*` or `typebox` | Verify: `! rg -l "@earendil-works" packages/core/src`
- [x] S05 [D05]: `runBinary` bounds output, honors abort and `okExitCodes`, and reports `command not found`/missing cwd; `truncateText` and `displayTarget` are shared | Verify: `npx vitest run packages/core/src/exec.test.ts packages/core/src/format.test.ts`
- [x] S06 [D06]: `Effect` and `Rule.effect` accept `allow`, `ask`, and `deny` end to end (type, loader, evaluator) | Verify: `npx vitest run packages/core/src/config.test.ts`
- [x] S07 [D07]: `ModeLayer { name, defaults, overrides?, onEnter? }` is the public mode seam; no exported `apply` callback or `inPlanPaths` detail | Verify: `! rg -l "ModeApplyDetails" packages/core/src packages/pi-guard/src packages/pi-acp/src`
- [x] S08 [D08]: verdicts follow hard safety, project deny, mode override, project specificity with stricter ties, mode default; shuffled rule arrays yield identical verdicts | Verify: `npx vitest run packages/core/src/policy.test.ts`
- [x] S09 [D09]: built-in layers match the matrix (`ask` allow/ask/ask, `edit` allow/allow/ask, `plan` allow/deny/ask) and `ask` is the session default | Verify: `npx vitest run packages/core/src/modes.test.ts`
- [x] S10 [D10]: registry is first-wins per name; entry gates run in registration order and the first veto blocks the switch | Verify: `npx vitest run packages/core/src/modes.test.ts`
- [x] S11 [D11]: in `plan`, edits to `artifacts/plan.md`, `artifacts/specs.md`, `artifacts/tasks/**` ask (resolved against effective cwd); other edits deny; a merged `deny` still wins | Verify: `npx vitest run packages/core/src/modes.test.ts`
- [x] S12 [D12]: `pi-guard` asks via `ctx.ui.confirm` on `ask`, blocks on `deny`, keeps `/mode`, `alt+m`, truncation, and the `mode-guard` statusline value, with no local policy module | Verify: `npx vitest run packages/pi-guard/src/index.test.ts`
- [x] S13 [D13]: `pi-budgets` vetoes autopilot entry without a token cap and allows it with a cap; `pi-autopilot` only registers the layer | Verify: `npx vitest run packages/pi-budgets/src/index.test.ts packages/pi-autopilot/src/index.test.ts`
- [x] S14 [D14]: `/cd` works without `pi-guard`; `fd`/`rg` keep `ask` results and drop only `deny`; args use `--glob…--` and `--regexp…--` | Verify: `npx vitest run packages/pi-tools/src/index.test.ts packages/pi-tools/src/fd.test.ts packages/pi-tools/src/rg.test.ts`
- [x] S15 [D15]: ACP `ask` with no connected client resolves to deny and never sends a permission request | Verify: `npx vitest run packages/pi-acp/src/extension/index.test.ts`
- [x] S16 [D16]: the bundled extension imports core for verdicts; `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts`, `exec.ts` are absent from `packages/pi-acp/src/extension` | Verify: `! rg -l "checkBash|loadRules|function decide" packages/pi-acp/src`
- [x] S17 [D17]: spawned pi args include `-nbt` alongside `-ne -e <extension>` | Verify: `npx vitest run packages/pi-acp/src/pi-rpc.test.ts`
- [x] S18 [D18]: reload and startup failure tear down the prior live session; prompt handlers exist before dispatch; exit/close rejects pending work; mode is pushed on connect and pre-handshake sets are buffered | Verify: `npx vitest run packages/pi-acp/src/adapter.test.ts`
- [x] S19 [D19]: `session/request_permission` carries the pi tool-call id; terminal polling has a wall-clock bound; timed-out client RPCs remove their pending entry | Verify: `npx vitest run packages/pi-acp/src/adapter.test.ts packages/pi-acp/src/client-requests.test.ts`
- [x] S20 [D20]: `acp_write` creates parents, `acp_edit` errors on missing files and buffer drift, `acp_fd`/`acp_rg` terminate flags, `acp_eza` requires a directory | Verify: `npx vitest run packages/pi-acp/src/extension/tools.test.ts`
- [x] S21 [D21]: extension statusline segments use the component/pill pipeline; overflow truncates left text before right-pinned sections | Verify: `npx vitest run packages/pi-statusline/src/render.test.ts packages/pi-statusline/src/components.test.ts`
- [x] S22 [D22]: dashboard aborts in-flight commands on `stop()`/shutdown and passes render width to `fitLines` | Verify: `npx vitest run packages/pi-dashboard/src/index.test.ts packages/pi-dashboard/src/render.test.ts`
- [x] S23 [D23]: core package version is `0.2.0`; every consumer dependency range is `^0.2.0` | Verify: `! rg -l '"@hollowheap/core": "0\.1\.0"' packages`
- [x] S24 [D24]: mode changes append `hollowheap.core.mode`; restore reads `getEntries()`; resume and fork keep the mode | Verify: `npx vitest run packages/core/src/state.test.ts`
- [x] S25 [D25]: config modes load from `<agentDir>/modes.json` (default `~/.pi/agent/modes.json`) | Verify: `npx vitest run packages/core/src/config.test.ts`
- [x] S26 [D26]: `modes.json` validates defaults for all tags, rejects `allow` overrides and name collisions with diagnostics, and reload replaces config layers only | Verify: `npx vitest run packages/core/src/config.test.ts`
- [x] S27 [D27]: restoring a mode re-runs entry gates; a veto restores `ask` with a notice | Verify: `npx vitest run packages/core/src/state.test.ts`
- [x] S28 [D34]: the ACP adapter learns the mode list from the extension, so an extension-registered mode is selectable; a mode notice rides in the returned config option's description | Verify: `npx vitest run packages/pi-acp/src/adapter.test.ts packages/pi-acp/src/extension/index.test.ts`
- [x] S29 [D35]: a hook runs a command with the tool call JSON on stdin; the verdict comes from stdout, exit code 2, or a failure | Verify: `npx vitest run packages/pi-hooks/src/hooks.test.ts`
- [x] S30 [D36]: hooks load from `<agentDir>/hooks.json` and, for trusted projects only, `<project>/.pi/hooks.json` | Verify: `npx vitest run packages/pi-hooks/src/config.test.ts`
- [x] S31 [D37]: a pre-hook can block a call with a reason but never rewrites the tool input | Verify: `npx vitest run packages/pi-hooks/src/index.test.ts`
- [x] S32 [D38]: a post-hook appends its output to the tool result and never replaces the result | Verify: `npx vitest run packages/pi-hooks/src/index.test.ts`
- [x] S33 [D39]: pi-hooks registers no model-callable tool; the bundled skill is the model's only way to configure hooks | Verify: `! rg -l "registerTool" packages/pi-hooks/src`
- [x] S34 [D40]: a pre-hook that fails or times out blocks the call with the failure as the reason | Verify: `npx vitest run packages/pi-hooks/src/index.test.ts`
- [x] S35 [D41]: the bundled skill is contributed through `resources_discover` and is discoverable in both installed and local runs | Verify: `npx vitest run packages/pi-hooks/src/index.test.ts`
- [x] S36 [D44]: `pi-question` registers no model tool; a live assistant `message_end` parses text content for question blocks and opens dialogs; resumed/replayed messages are not re-asked | Verify: `npx vitest run packages/pi-question/src/index.test.ts`
- [x] S37 [D45]: core exports `scanTaggedBlocks(markdown)` returning `{ tag, body, start, end, closed }` for `'''tag` through `'''`; it ignores markdown code fences and handles multiple or unclosed blocks without throwing | Verify: `npx vitest run packages/core/src/blocks.test.ts`
- [x] S38 [D45]: core exports `parseMarkdownBlocks(body)` returning heading/list/listItem/paragraph nodes with ordered and optional checked state, no inline parsing, and no throw on malformed input | Verify: `npx vitest run packages/core/src/blocks.test.ts`
- [x] S39 [D45]: core's new blocks module is exported from `src/index.ts`, imports no `@earendil-works/*` or `typebox`, and adds no runtime dependency | Verify: `! rg -l "@earendil-works|typebox" packages/core/src/blocks.ts && jq -e 'has("dependencies") | not' packages/core/package.json >/dev/null`
- [x] S40 [D46]: the question parser accepts H2 per question and ordered-list options; all checked means multi (checkbox is a mode marker, not preselection), none means single, mixed/9+ options/reserved write-in means invalid; zero options is free-text; source order is preserved | Verify: `npx vitest run packages/pi-question/src/questions.test.ts`
- [x] S41 [D47]: TUI single-select uses `ctx.ui.select` with a final write-in row, then `ctx.ui.input` for write-in; cancellation cancels the whole set | Verify: `npx vitest run packages/pi-question/src/index.test.ts`
- [x] S42 [D47]: TUI multi-select uses `ctx.ui.custom` checkbox rows with a final write-in row, toggles with space, submits with Enter, and allows zero selections | Verify: `npx vitest run packages/pi-question/src/index.test.ts`
- [x] S43 [D47]: RPC single uses `select`/`input`; RPC multi uses a `select` toggle loop with `[ ]`/`[x]` rows, a write-in row, and Done; zero selections is valid and cancellation cancels the set | Verify: `npx vitest run packages/pi-question/src/index.test.ts`
- [x] S44 [D47]: `ctx.hasUI` gates the prompt section and dialogs; print/json add no section and open no dialogs; TUI uses the custom multi-select path and RPC uses the select-loop | Verify: `npx vitest run packages/pi-question/src/index.test.ts`
- [x] S45 [D48]: `before_agent_start` sets a stable `sections.question_format` only when `ctx.hasUI`; the section teaches the fence, H2, ordered list, checkbox multi, implicit write-in, 0-8 options, no-tool turn ending, and follow-up answers | Verify: `npx vitest run packages/pi-question/src/index.test.ts`
- [x] S46 [D49]: the markdown transformer removes valid `question` blocks only in assistant messages; unknown tags and fully closed invalid blocks stay; open fences are removed while streaming; markdown code fences are ignored | Verify: `npx vitest run packages/pi-question/src/index.test.ts`
- [x] S47 [D49]: answers send one `hollowheap.question.answers` message with `display: true` and `deliverAs: "followUp"`, numbered answers only; a registered renderer shows the custom message and tolerates missing details | Verify: `npx vitest run packages/pi-question/src/index.test.ts`
- [x] S48 [D50]: cancelling any dialog cancels the whole set, sends no follow-up, and does not throw; no tool fallback exists | Verify: `npx vitest run packages/pi-question/src/index.test.ts`
- [x] S49 [D51]: `pi-question` removes the `question` tool and TypeBox/pi-ai imports, adds `@hollowheap/core` at `^0.2.0`, and documents the breaking removal, fence format, display-only TUI strip, RPC behavior, and write-in | Verify: `! rg -l "registerTool|defineTool|typebox|@earendil-works/pi-ai|@earendil-works/pi-agent-core" packages/pi-question/src packages/pi-question/package.json && rg -q "'''question" packages/pi-question/README.md`
- [x] S50 [D52]: `pi-question` ignores unknown tags and fully closed malformed `question` blocks, leaving them visible; only valid question blocks trigger dialogs or stripping; malformed input never crashes | Verify: `npx vitest run packages/pi-question/src/index.test.ts`
- [x] S51 [D53]: a question accepts 0-8 options, write-in is capped at 500 characters, questions are asked in source order, zero options uses free-text input, and empty/zero-selection answers are represented explicitly | Verify: `npx vitest run packages/pi-question/src/questions.test.ts`
- [x] S52 [D54]: `packages/pi-todos` is a pi extension with no model tool, depends on `@hollowheap/core` at `^0.2.0`, and is listed in the root `pi.extensions` | Verify: `jq -e '.pi.extensions | index("./packages/pi-todos/src/index.ts")' package.json >/dev/null && ! rg -l "registerTool|defineTool|typebox|@earendil-works/pi-ai|@earendil-works/pi-agent-core" packages/pi-todos/src packages/pi-todos/package.json`
- [x] S53 [D55]: todo state is a branch-local `hollowheap.todos` custom entry, restored from `getBranch()` on `session_start`/`session_tree`, appended once per changed assistant message, with monotonic IDs and no global/file state | Verify: `npx vitest run packages/pi-todos/src/index.test.ts`
- [x] S54 [D56]: `create_todos` parses exactly one ordered list of non-empty task texts, appends in order, assigns stable numeric IDs, and rejects checkboxes, unordered lists, and empty lists | Verify: `npx vitest run packages/pi-todos/src/todos.test.ts`
- [x] S55 [D56]: `complete_todos` parses exactly one ordered list of positive numeric IDs, marks matching todos done once, ignores unknown IDs with a report, and rejects malformed IDs | Verify: `npx vitest run packages/pi-todos/src/todos.test.ts`
- [x] S56 [D56]: a changed message sends one `hollowheap.todos.updated` follow-up with full ID list and unknown IDs, and a renderer falls back to content without throwing | Verify: `npx vitest run packages/pi-todos/src/index.test.ts`
- [x] S57 [D57]: `/todos` lists every todo with ID and done marker; `ctx.ui.setStatus("todos", ...)` shows open/total and clears when empty | Verify: `npx vitest run packages/pi-todos/src/index.test.ts`
- [x] S58 [D58]: `before_agent_start` adds a stable `sections.todos_format` only when `ctx.hasUI`; the section teaches both fences, ordered lists, numeric IDs, append semantics, confirmation, and no-tool flow; print/json add no section | Verify: `npx vitest run packages/pi-todos/src/index.test.ts`
- [x] S59 [D59]: the assistant TUI transformer strips valid closed todo blocks and open todo fences while streaming, leaving unknown tags, closed invalid blocks, non-assistant messages, and code fences visible; stored/RPC text keeps the fence | Verify: `npx vitest run packages/pi-todos/src/index.test.ts`
- [x] S60 [D54]: malformed and unknown todo blocks never crash or mutate state; only valid closed blocks trigger state changes or display stripping; duplicate `message_end` for the same message is ignored | Verify: `npx vitest run packages/pi-todos/src/index.test.ts packages/pi-todos/src/todos.test.ts`
- [x] S61 [D54]: `pi-todos/README.md` documents the fence format, no-tool flow, branch state, `/todos`, status count, TUI-only stripping, RPC raw fence, and print/json gating; the package manifest and root workspace are consistent | Verify: `rg -q "'''create_todos" packages/pi-todos/README.md && rg -q "hollowheap.todos" packages/pi-todos/README.md && npm test`
- [x] S62 [D60]: `ctx.ui.setWidget("todos", ...)` shows up to five open todos with IDs above the editor, adds `+N more (/todos)` when capped, omits completed todos, and clears when no open todos remain; restore and every state change update it | Verify: `npx vitest run packages/pi-todos/src/todos.test.ts packages/pi-todos/src/index.test.ts`
- [x] S63 [D61]: `packages/pi-code-intel` is a pi extension with one `code_intel` tool exposed through codemode, depends on `@hollowheap/core` at `^0.2.0`, and is listed in the root `pi.extensions` | Verify: `jq -e '.pi.extensions | index("./packages/pi-code-intel/src/index.ts")' package.json >/dev/null && jq -e '.dependencies["@hollowheap/core"] == "^0.2.0"' packages/pi-code-intel/package.json >/dev/null && rg -q 'name: "code_intel"' packages/pi-code-intel/src && rg -q 'exposure: "codemode"' packages/pi-code-intel/src && ! rg -q 'typebox' packages/pi-code-intel/package.json`
- [x] S64 [D62]: the LSP client uses Node builtins over stdio, frames JSON-RPC with Content-Length, lazily pools one server per command/args/root, applies request timeouts, synchronizes open documents from disk, and kills every server on session shutdown | Verify: `npx vitest run packages/pi-code-intel/src/lsp.test.ts`
- [x] S65 [D63]: built-in language mappings are overlaid by `<agentDir>/code-intel.json`; malformed entries are diagnosed and dropped; servers spawn only in trusted projects, never auto-install, and missing commands return a setup hint | Verify: `npx vitest run packages/pi-code-intel/src/config.test.ts packages/pi-code-intel/src/tool.test.ts`
- [x] S66 [D64]: `code_intel` supports `definition`, `references`, `document_symbols`, and `workspace_symbols`; positions are 1-based; results are capped, formatted, and filtered with core read/search rules; validation and server failures return text | Verify: `npx vitest run packages/pi-code-intel/src/tool.test.ts`
- [x] S67 [D61]: `pi-code-intel/README.md` documents actions, 1-based positions, built-in mappings, config schema, trust gating, no auto-install, and codemode exposure; the package manifest, root extension list, and lock are consistent; the full suite is green | Verify: `rg -q "code_intel" packages/pi-code-intel/README.md && npm test && npm run typecheck && npm run lint`


Status: resolved 2026-10-19 from pi and anchor sources; ready for implementation. Not implemented.

### Problem

`packages/pi-acp` re-implements policy that `pi-guard` already owns:

- `packages/pi-acp/src/extension/rules.ts`, `loader.ts`, `bash.ts` — byte-identical vendored copies of pi-guard's.
- `packages/pi-acp/src/extension/modes.ts:19-34` — a second `decide()` mirroring pi-guard's `applyPolicy` (`packages/pi-guard/src/modes.ts:33-46`).
- `packages/pi-acp/src/extension/index.ts:63,151-207` — its own mode state, `tool_call` gate, and shell gate.
- `packages/pi-acp/src/adapter.ts:28-29,145-172,545` — a hardcoded `MODES` list and `set_config` validation.

Drift is guaranteed: the two policy copies must be hand-synced, and already diverge structurally (`applyPolicy` is rule-driven; `decide` is a hand-written table).

### Goal

pi-acp owns only two things: (1) fallbacks when pi-guard is absent, and (2) making ACP work over `pi --mode rpc`. All rule, mode, and permission decisions come from pi-guard loaded in the same pi process.

### Non-goals

- Not changing pi-guard's policy semantics (see `packages/pi-guard/README.md` outcome matrix).
- Not removing the `acp_*` tools; they stay as the client-routing surface.

### Target architecture

Spawn the ACP pi process with pi-guard loaded alongside the bundled tools extension:

```text
pi --mode rpc -ne -e <pi-guard package dir> -e <pi-acp/src/extension> --append-system-prompt ...
```

Guard path resolution (resolved): pi's loader resolves `-e` values as filesystem paths, never as bare package names (`loader.js:663-699` resolves each configured path with `resolvePath` and only unpacks directories; a bare name becomes `<cwd>/@hollowheap/pi-guard` and fails). It does read `pi.extensions` from a directory (`loader.js:593-621`), so passing the pi-guard package directory loads `src/index.ts`.

- Primary: `createRequire(import.meta.url).resolve("@hollowheap/pi-guard/package.json")`, then `dirname(...)` → package dir. Works because pi-guard's manifest has no `exports` map, and requires adding `@hollowheap/pi-guard` to `packages/pi-acp/package.json` (its "no dependencies" claim at `README.md:3` must then change).
- Override: `HOLLOWHEAP_ACP_GUARD` (path to the package dir or extension entry).
- Fallback: unresolved guard → spawn without it; the bundled extension owns modes/permissions alone (Fallbacks section).

- pi-guard is the single enforcement owner (`tool_call` hook, modes, approvals, shell gate).
- `packages/pi-acp/src/extension/` keeps only `acp_*` tools (client `fs`/`terminal` routing with local fallbacks), the socket client, and the mode/permission bridge. It deletes `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts` and the `tool_call` hook.

### Interface contract: rpc approvals

pi's rpc mode already bridges extension UI to ACP-shaped requests. Verified shapes (`node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts:406-476`):

- Request: `{ type: "extension_ui_request", id, method: "confirm", title, message, timeout? }`.
- Reply: `{ type: "extension_ui_response", id, confirmed: boolean }` or `{ ..., cancelled: true }`.
- pi-guard's `requestApproval` (`packages/pi-guard/src/index.ts:66-88`) calls `ctx.ui.confirm`, which rpc-mode surfaces as the request above (`.../rpc-mode.js:85`).

Contract: the adapter answers every `method: "confirm"` request by calling ACP `session/request_permission` with exactly `allow_once`/`reject_once`, then replies `confirmed: true` for allow and `confirmed: false` for reject. With no client connected, reply `cancelled: true` (fail closed). No other `extension_ui_request` method is answered by policy; `notify`/`setStatus` etc. map to ACP where a client capability exists and are dropped otherwise.

### Interface contract: mode list

The adapter needs the mode list for `SessionConfigOption category "mode"` (`adapter.ts:145-172`). Contract:

- pi-guard's existing `guard:modes` query (emitted every `session_start`, `packages/pi-guard/src/index.ts`) is the source of truth.
- The bundled extension subscribes to `guard:modes`, forwards `{ modes }` to the adapter over the socket, and the adapter builds config options from names + descriptions.
- Fallback: if no `guard:modes` contributor answers within the session-start window, the extension forwards the built-in `plan`/`ask`/`edit` list itself. This is the "define fallbacks" obligation.

### Interface contract: mode set

rpc has no generic slash-command invocation (`rpc-types.d.ts:14-140`), so ACP `set_config` cannot drive pi-guard's `/mode`. Contract:

- pi-guard gains a `guard:mode-set { mode, owner? }` command envelope applied through its existing `switchMode` path (`packages/pi-guard/src/index.ts:124-147`), so the `guard:mode-enter` veto/notice still runs.
- The bundled extension, on adapter `set_config`, emits `guard:mode-set`; without pi-guard it falls back to its local default list.
- Scoping (resolved): `switchMode` needs an `ExtensionContext` for `ctx.ui.notify` and `ctx.sessionManager`. pi-guard already sees one on every `session_start` (`index.ts:230-235`); it stores it as the active context and the envelope handler applies only when `owner === undefined || owner === activeCtx.sessionManager`, ignoring stale owners. The notice surfaces to ACP as `extension_ui_request{method:"notify"}` (`rpc-types.d.ts:436`) which the adapter may drop.

### Interface contract: acp_* tool tagging

pi-guard's `TOOL_TAGS` (`packages/pi-guard/src/index.ts:37`) covers built-ins only, so `acp_read/acp_write/acp_edit/acp_bash/acp_fd/acp_rg/acp_eza` currently fall to the unknown-tool ask. Contract (resolved):

1. `guard:tool-tags` query (chosen): extensions register `{ name -> tag }` contributions; pi-guard composes its map at session start (`index.ts:163-164` consumes it synchronously per call) exactly like the existing `guard:modes` query (`index.ts:109-113`). Keeps policy single-owned and extensible; the bundled extension contributes `acp_read -> read`, `acp_fd/acp_rg/acp_eza -> search`, `acp_write/acp_edit -> edit`, `acp_bash -> shell`. Rejected: 2 (drop `acp_*` tools, losing client `fs`/`terminal` routing) and 3 (wrap built-ins, which cannot survive the hook running before execute).

### Interface contracts: data shapes

All envelope contributions are synchronous in-place mutations, matching `guard:modes` (`packages/pi-guard/src/index.ts:109-113`); the emitter owns the object and reads it back immediately.

```ts
// pi.events, pi-guard emits at session_start, contributors mutate
"guard:tool-tags": { tags: Record<string, Tag> }        // prefilled with builtins
"guard:modes":     { modes: ModeDefinition[] }          // existing, unchanged
"guard:mode-set":  { mode: string; owner?: unknown }    // command, pi-guard applies

// unix socket, adapter <-> bundled extension
"modes":    extension -> adapter  { modes: { name: string; description?: string }[] }
"set-mode": adapter -> extension  { mode: string }

// pi rpc, pi <-> adapter (rpc-types.d.ts:406-419, 463-476)
{ type: "extension_ui_request",  id: string, method: "confirm", title, message, timeout? }
{ type: "extension_ui_response", id: string, confirmed: boolean } | { id: string, cancelled: true }
```

Tag values are the four literals (`edit`, `read`, `search`, `shell`); the bundled extension keeps its own local union instead of adding a `@hollowheap/core` dependency, since the loader cannot resolve bare imports at runtime anyway.

### Fallbacks when pi-guard is absent

Only when pi-guard is not installed or fails to resolve (`SpawnPiOptions` degrades to the bundled extension alone):

- Modes: the bundled extension advertises the local `plan`/`ask`/`edit` list and applies `set_config` locally.
- Enforcement: none — no rules file, no allowlist, no mode policy. Reads and writes run.
- Shell: `acp_bash` asks the client for every command (`session/request_permission`); no client means deny. This is the rules-free degenerate case of "no allow rule → ask", not a second policy engine.
- Blast radius is bounded by the guard-absent condition and documented in the README.

### Removal list (on implementation)

- Delete `packages/pi-acp/src/extension/{rules,loader,bash,modes}.ts` and their tests.
- Delete the `tool_call` hook, `getMode`, and gate branches in `packages/pi-acp/src/extension/index.ts`.
- Delete the bash gate and mode import in `packages/pi-acp/src/extension/tools.ts`.
- Replace `MODES`/`modeOption` in `adapter.ts` with mode descriptors received over the socket.
- Widen `SpawnPiOptions.extensionPath` (`adapter.ts:40,68`, `pi-rpc.ts:158-171`, `main.ts:66-76`) to carry the guard dir plus the bundled entry as two `-e` flags.
- Add the `@hollowheap/pi-guard` dependency and drop the "no dependencies" claim (`packages/pi-acp/README.md:3`).
- Retire the pi-guard-vendoring note for pi-acp in `packages/core/README.md:20` and `packages/pi-acp/README.md:35`.

### Resolutions (2026-10-19)

1. Guard path: resolved above — directory path via `createRequire`, `HOLLOWHEAP_ACP_GUARD` override, spawn-without-guard fallback. Bare package names do not work through `-e`.
2. `acp_*` tagging: `guard:tool-tags` query, resolved above.
3. `guard:mode-set` scoping: `{ mode, owner? }` with pi-guard's stored active `ExtensionContext`, resolved above.
4. `ctx.hasUI` under rpc: true. `ExtensionContext.hasUI` is documented "true in TUI and RPC modes" (`core/extensions/types.d.ts:218-219`), and rpc-mode wires `ui.confirm` into an `extension_ui_request` (`modes/rpc/rpc-mode.js:85`). So `requestApproval` (`pi-guard/src/index.ts:66-88`) cannot short-circuit on `!hasUI`, and every ask becomes a confirm request. The adapter must therefore answer every confirm, including after client disconnect (reply `cancelled: true`).
5. Session-start firing: pi-guard emits `guard:modes` on every `session_start` (`index.ts:233` via `refreshModes`), and `session_start` fires for reasons `startup | reload | new | resume | fork` (`types.d.ts:561-568`). No specific firing is "the" one: the bridge forwards each `guard:modes` and the adapter adopts the latest (last-wins); contributors stay idempotent (pi-autopilot already is).

### Acceptance criteria

- `npm run typecheck`, `npm test`, `npm run lint` green; `npx tsc -p packages/pi-acp` builds dist.
- No policy duplication: `rg -n "decide|checkBash|applyPolicy" packages/pi-acp/src/extension` returns only fallback references, not a second implementation.
- Live ACP smoke: mode switch from the client reaches pi-guard; an unlisted call in `ask` raises one `session/request_permission`.

## Spec: tool-free todos (pending 2026-10-22)

Decision source: D54-D60. A new `pi-todos` extension owns tagged todo blocks, branch-local session state, `/todos`, the compact widget, and the status count; it registers no model tool. Core remains the scanner/AST owner.

### 1. Package boundary

- `packages/pi-todos/src/index.ts` is the extension entry; its `package.json` declares the pi extension and the root `pi.extensions` list adds `./packages/pi-todos/src/index.ts`.
- It depends on `@hollowheap/core` at `^0.2.0` and keeps `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as peer dependencies. It has no `typebox`, `pi-ai`, or `pi-agent-core` dependency and registers no model tool.
- The version stays `0.2.0`; no coordinated release is part of this task.
- Core gains no code beyond the existing `scanTaggedBlocks`/`parseMarkdownBlocks` seam.

### 2. Block format

```text
'''create_todos
1. Write the parser tests
2. Update the README
'''

'''complete_todos
1. 2
'''
```

- `create_todos` has exactly one ordered list. Every item text is a non-empty task, after trimming. Checkbox markers (`[ ]`/`[x]`) are not part of the format and make the block invalid. At least one item is required.
- `complete_todos` has exactly one ordered list. Every item text is a positive decimal ID (`1`, `2`, ...); leading zeros and non-numeric text are invalid. At least one ID is required. Duplicate IDs are applied once.
- A block with any other node, an empty list, an unordered list, or malformed text is invalid as a whole.
- Multiple todo blocks in one assistant message are processed in source order. Only fully closed blocks are handled.

### 3. State

- The state shape is `{ todos: { id: number; text: string; done: boolean }[]; nextId: number }`.
- State is branch-local: on `session_start` and `session_tree`, clear the in-memory state and reconstruct it by scanning `ctx.sessionManager.getBranch()` for the latest `entry.type === "custom"` with `customType === "hollowheap.todos"`; use `entry.data`.
- A valid `create_todos` appends tasks in list order and assigns monotonic numeric IDs from `nextId`. It never replaces or deletes existing todos.
- A valid `complete_todos` marks matching IDs done. Unknown IDs are ignored and reported; they never throw.
- After one assistant message is fully processed, append one `hollowheap.todos` custom entry only when the state changed. Do not append one entry per block.
- IDs are never reused. Completed todos remain in the list with `done: true`.

### 4. Confirmation message

- After at least one valid todo block, send one custom follow-up:
  `pi.sendMessage({ customType: "hollowheap.todos.updated", content, display: true, details: { todos, unknownIds } }, { deliverAs: "followUp" })`.
- `content` lists every todo as `#<id> [ ] <text>` or `#<id> [x] <text>`, in ID order. Append `Unknown IDs: <comma-separated>` when a valid completion named IDs that were not found. The content is the model-visible confirmation that lets it learn assigned IDs.
- Register a renderer for `hollowheap.todos.updated` that renders the numbered list and falls back to `content` when details are missing; it never throws.
- No confirmation is sent for an invalid block that changed nothing.

### 5. `/todos`, widget, and status

- `/todos` lists every todo in ID order with `#<id>`, a done marker, and the text. TUI uses a closeable custom list component; RPC uses `ctx.ui.notify` with the same text. Print/json never open a dialog.
- `ctx.ui.setStatus("todos", text)` shows `open/total` after every state change and after restore. When the list is empty, call `setStatus("todos", undefined)`.
- `ctx.ui.setWidget("todos", lines)` shows up to five open todos above the editor as `#<id> <text>`, under a `Todos (<n> open)` header. When more open todos remain, append `+<n> more (/todos)`. Omit completed todos. Clear the widget with `undefined` when no open todos remain. Restore and every state change update it.
- RPC receives the same string-array widget through the extension UI protocol. Print/json set neither status nor widget.

### 6. Prompt and gating

- A `before_agent_start` handler adds `event.systemPromptOptions.sections.todos_format` only when `ctx.hasUI` is true. The key is stable, and the handler does not return or force a system prompt.
- The section teaches: the exact `'''create_todos` and `'''complete_todos` fences; ordered-list task texts; no checkboxes in `create_todos`; numeric IDs in `complete_todos`; append semantics; one follow-up confirmation with IDs; `/todos`; and no model tool.
- Print/json get no section.

### 7. Message hook and display transformer

- On `message_end` with an assistant message and `ctx.hasUI`, parse text content blocks for closed `create_todos`/`complete_todos` blocks. Ignore user/thinking content, unknown tags, invalid blocks, and unclosed blocks. Never replace the assistant message.
- A live message is handled once; resumed or replayed messages are not re-asked. Malformed input never crashes.
- `registerMarkdownTransformer` removes valid closed todo blocks only from assistant TUI markdown. It removes an open todo fence from its opening line through the current end while `context.isStreaming` is true. Unknown tags, fully closed invalid blocks, non-assistant messages, and markdown code fences stay untouched.
- The stored message and model context keep the raw fence; RPC clients still receive it.

### 8. Tests and docs

- `packages/pi-todos/src/todos.test.ts` covers create/complete parsing, append and IDs, completion, unknown IDs, invalid/mixed blocks, the confirmation text, and widget formatting/capping.
- `packages/pi-todos/src/index.test.ts` covers the message hook, branch restore/persist, status count and widget updates, confirmation message/renderer, prompt gating, display stripping, `/todos`, duplicate-message handling, and malformed input.
- `packages/pi-todos/README.md` documents the format, no-tool flow, session state, the compact widget, `/todos`, status count, TUI-only stripping, RPC raw-fence limitation, and print/json gating.
- Root `package.json`, workspace lock, typecheck, tests, and lint are consistent.

## Spec: code intelligence (pending 2026-10-23)

Decision source: D61-D64. A new `pi-code-intel` extension owns LSP-backed, read-only navigation and registers one `code_intel` codemode tool. It adds no UI, command, or other model tool; core stays host-free and `pi-tools` stays stateless.

### 1. Package boundary

- `packages/pi-code-intel/src/index.ts` is the extension entry. Its `package.json` declares it as a pi extension, lists `@hollowheap/core` at `^0.2.0` in `dependencies`, and keeps `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` as peers. It has no `typebox` or `pi-agent-core` dependency.
- The root `package.json` `pi.extensions` list includes `./packages/pi-code-intel/src/index.ts`. The version stays `0.2.0`.
- The extension registers exactly one tool, `code_intel`, with `exposure: "codemode"`, and activates codemode on `session_start` when the host exposes it and it is not already active.
- It owns server processes, configuration, and cleanup. Core gains no LSP or process code.

### 2. Tool contract

```ts
code_intel({
  action: "definition" | "references" | "document_symbols" | "workspace_symbols",
  path: string,        // required; selects the language server
  line?: number,       // 1-based, required for definition/references
  column?: number,     // 1-based, required for definition/references
  query?: string,      // required for workspace_symbols
  max_results?: number // core clamp: default 100, max 500
})
```

- `path` is required for every action and resolves against the effective cwd (`effectiveCwd(ctx.cwd, ctx.sessionManager)`); it must be inside `ctx.cwd` under core path rules. For `workspace_symbols`, the path selects which language server answers the workspace-wide query.
- Input positions are 1-based editor coordinates. The client converts them to 0-based LSP `line`/`character`.
- `definition` and `references` return one `path:line:column` per location, where line/column are 1-based and path is relative to the effective cwd.
- `document_symbols` returns an indented outline, `name (kind) path:line`, with child symbols indented two spaces per depth.
- `workspace_symbols` returns `path:line:column name (kind) [container]`.
- Empty results return `No definitions found.`, `No references found.`, `No symbols found.`, or `No workspace symbols found.`.
- Results are capped by `max_results`; when more are available, append `... (truncated)`.
- Validation errors, denied paths, untrusted projects, missing servers, timeouts, and server failures return explanatory text. They never throw and never return partial mutation state.

### 3. LSP transport and lifecycle

- The client uses only Node builtins. It spawns the configured command with `args`, `cwd: ctx.cwd`, `stdio: ["pipe", "pipe", "pipe"]`, and the inherited environment. It never uses a shell.
- JSON-RPC messages are framed with `Content-Length` in UTF-8 bytes. The parser handles partial headers, partial bodies, and multiple messages in one chunk; header names are case-insensitive.
- The client sends `initialize` with `processId`, `rootUri` for `ctx.cwd`, workspace-folder metadata, and capabilities for definition (including link support), references, hierarchical document symbols, and workspace symbols. It sends `initialized` before queries.
- One server is pooled per `command + args + root`. Servers start lazily on the first query and are reused. Requests and document synchronization are serialized per server. The pool lives on a process-global symbol so a jiti reload can dispose the previous instance's servers.
- The server may send requests (`workspace/configuration`, capability registration, progress creation) and notifications. The client answers known setup requests with `null`/empty configuration, ignores diagnostics and progress, and answers unknown requests with `null`. It never crashes on server traffic.
- Before a position or document-symbol query, the client reads the file from disk. On first use it sends `textDocument/didOpen` with the server's language id, version `1`, and the disk text. When the disk text changed, it sends a full-text `textDocument/didChange` with the next version. Missing or non-file targets return text.
- The default request timeout is 10 seconds; per-server `timeoutMs` may lower or raise it up to 60 seconds. A timeout or protocol failure kills that server, rejects pending requests, and removes it from the pool; the next query may respawn it.
- Server stderr is captured in a bounded buffer for error text and is not printed. Server exit rejects pending requests and removes the pool entry.
- `session_start` disposes stale servers before restoring anything. `session_shutdown` disposes all servers, sending `shutdown`/`exit` and then killing the child. Cleanup is best-effort and never blocks the session.

### 4. Configuration and trust

- Built-in mappings cover TypeScript/JavaScript (`typescript-language-server --stdio`), Python (`pyright-langserver --stdio`), Rust (`rust-analyzer`), Go (`gopls`), C/C++ (`clangd`), and Lua (`lua-language-server`).
- Built-ins use extension maps so TypeScript and JavaScript get distinct language ids (`.ts` -> `typescript`, `.tsx` -> `typescriptreact`, `.js` -> `javascript`, `.jsx` -> `javascriptreact`).
- `<agentDir>/code-intel.json` overlays built-ins by server name and adds new servers:

```json
{
  "servers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensions": { ".ts": "typescript", ".tsx": "typescriptreact" },
      "timeoutMs": 10000
    }
  }
}
```

- `command` is a non-empty string, `args` is a string array, `extensions` is a non-empty suffix-to-language-id map, and `timeoutMs` is a positive integer. Invalid entries are dropped with one `ctx.ui.notify` diagnostic per file change. A user entry replaces the built-in of the same name.
- User servers are matched before built-ins; the first server claiming the file suffix wins. A duplicate suffix across user servers is diagnosed and the later one is ignored.
- No project-level config is read. No server is auto-installed or resolved from `node_modules`.
- The tool requires `ctx.isProjectTrusted()` before spawning or reusing a server. In an untrusted project it returns a trust-gate message and starts nothing. The server runs with the user's permissions and can read more than the tool returns; trust gating plus result filtering is the boundary.

### 5. Permissions and formatting

- Permissions come from core `loadPermissions` with `getAgentDir()`, `ctx.cwd`, and `ctx.isProjectTrusted()`, cached through core.
- The input path and every returned location are checked with `checkPath(rules, abs, "read", ctx.cwd)`. A `deny` drops the location; `ask` is treated as allowed, matching `pi-tools`.
- Display paths use `displayPath(effectiveCwd, absolute)` and forward slashes. Workspace symbols outside the workspace are dropped.
- Kind formatting maps LSP `SymbolKind` numbers to lower-case names (`function`, `method`, `class`, ...). Unknown kinds render as `symbol`.
- Output is plain text in the tool content; `details` carries `action`, `path`, `count`, and `truncated` for codemode scripts.

### 6. Tests and docs

- `src/lsp.test.ts` covers framing (partial/multiple messages), response routing, timeouts, server crash, stderr capture, didOpen/didChange versions, server pooling, and cleanup. A fixture Node script speaks the minimal protocol; no real language server is required.
- `src/config.test.ts` covers built-in lookup, overlay by name, extension precedence, invalid entries, mtime diagnostics, and missing commands.
- `src/tool.test.ts` covers action validation, 1-based conversion, definition/reference/symbol formatting, caps, empty results, trust gating, path denial, missing server, timeout text, and no throws.
- `src/index.test.ts` covers tool registration/exposure, codemode activation, session cleanup, and that no UI, command, or second tool is registered.
- `packages/pi-code-intel/README.md` documents actions, 1-based positions, built-ins, the config schema, trust gating, no auto-install, codemode exposure, timeout behavior, and the read-only scope.
- Root manifest, workspace lock, typecheck, full tests, and lint are consistent.
