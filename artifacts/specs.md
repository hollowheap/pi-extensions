# Specs and interface contracts

  Executable specification index. Historical prose and anchors are archived in `artifacts/research/spec-prose-archive.md`; each `Sxx` records its contract, architecture section, and verification.

## Specification index (to-task input)

  Traceable behavioral specs. Historical rationale and anchors are in `artifacts/research/spec-prose-archive.md`; this list is the executable contract.

### Core runtime foundation

#### Module Seams

- [x] S01 [R08] [D01]: `@hollowheap/core` exports the only policy engine (`evaluate`, `loadPermissions`, `checkPath`, `checkShell`); no consumer ships rule parsing or shell analysis
  - Verify: `npx vitest run packages/core/src/policy.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S02 [R08] [D02]: core exports `session(owner)`, `setMode`, `effectiveCwd`, `resetSession`, `dropSession`; mode/cwd reads never traverse pi events
  - Verify: `npx vitest run packages/core/src/state.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S03 [R08] [D03]: state lives on `globalThis[Symbol.for("@hollowheap/core/state")]`; two independent module loads observe the same registry
  - Verify: `npx vitest run packages/core/src/state.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S04 [R08] [D04]: consumers declare `@hollowheap/core` in `dependencies` at `^0.2.0`; core imports no `@earendil-works/*` or `typebox`
  - Verify: `! rg -l "@earendil-works" packages/core/src`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S05 [R08] [D05]: `runBinary` bounds output, honors abort and `okExitCodes`, and reports `command not found`/missing cwd; `truncateText` and `displayTarget` are shared
  - Verify: `npx vitest run packages/core/src/exec.test.ts packages/core/src/format.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

#### Data & Contracts

- [x] S06 [R09] [D06]: `Effect` and `Rule.effect` accept `allow`, `ask`, and `deny` end to end (type, loader, evaluator)
  - Verify: `npx vitest run packages/core/src/config.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S07 [R09] [D07]: `ModeLayer { name, defaults, overrides?, onEnter? }` is the public mode seam; no exported `apply` callback or `inPlanPaths` detail
  - Verify: `! rg -l "ModeApplyDetails" packages/core/src extensions/pi-guard/src packages/pi-acp/src`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S08 [R09] [D08]: verdicts follow hard safety, project deny, mode override, project specificity with stricter ties, mode default; shuffled rule arrays yield identical verdicts
  - Verify: `npx vitest run packages/core/src/policy.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S09 [R09] [D09]: built-in layers match the matrix (`ask` allow/ask/ask, `edit` allow/allow/ask, `plan` allow/deny/ask) and `ask` is the session default
  - Verify: `npx vitest run packages/core/src/modes.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S10 [R09] [D10]: registry is first-wins per name; entry gates run in registration order and the first veto blocks the switch
  - Verify: `npx vitest run packages/core/src/modes.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S11 [R09] [D11]: in `plan`, edits to `artifacts/plan.md` and `artifacts/specs.md` ask (resolved against effective cwd); other edits deny; a merged `deny` still wins
  - Verify: `npx vitest run packages/core/src/modes.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

#### Module Seams

- [x] S12 [R10] [D12]: `pi-guard` asks via `ctx.ui.confirm` on `ask`, blocks on `deny`, keeps `/mode`, `alt+m`, truncation, and the `mode-guard` statusline value, with no local policy module
  - Verify: `npx vitest run extensions/pi-guard/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S13 [R10] [D13]: `pi-budgets` vetoes autopilot entry without a token cap and allows it with a cap; `pi-autopilot` only registers the layer
  - Verify: UNVERIFIED: `npx vitest run extensions/pi-budgets/src/index.test.ts extensions/pi-autopilot/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S14 [R10] [D14]: `/cd` works without `pi-guard`; `fd`/`rg` keep `ask` results and drop only `deny`; args use `--glob…--` and `--regexp…--`
  - Verify: UNVERIFIED: `npx vitest run extensions/pi-tools/src/index.test.ts extensions/pi-tools/src/fd.test.ts extensions/pi-tools/src/rg.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S15 [R10] [D15]: ACP `ask` with no connected client resolves to deny and never sends a permission request
  - Verify: `npx vitest run packages/pi-acp/src/extension/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S16 [R11] [D16]: the bundled extension imports core for verdicts; `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts`, `exec.ts` are absent from `packages/pi-acp/src/extension`
  - Verify: `! rg -l "checkBash|loadRules|function decide" packages/pi-acp/src`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

#### System Shape

- [x] S17 [R11] [D17]: spawned pi args include `-nbt` alongside `-ne -e <extension>`
  - Verify: `npx vitest run packages/pi-acp/src/pi-rpc.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S18 [R11] [D18]: reload and startup failure tear down the prior live session; prompt handlers exist before dispatch; exit/close rejects pending work; mode is pushed on connect and pre-handshake sets are buffered
  - Verify: `npx vitest run packages/pi-acp/src/adapter.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S19 [R11] [D19]: `session/request_permission` carries the pi tool-call id; terminal polling has a wall-clock bound; timed-out client RPCs remove their pending entry
  - Verify: `npx vitest run packages/pi-acp/src/adapter.test.ts packages/pi-acp/src/client-requests.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

#### Data & Contracts

- [x] S20 [R11] [D20]: `acp_write` creates parents, `acp_edit` errors on missing files and buffer drift, `acp_fd`/`acp_rg` terminate flags, `acp_eza` requires a directory
  - Verify: `npx vitest run packages/pi-acp/src/extension/tools.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

#### Module Seams

- [x] S21 [R12] [D21]: extension statusline segments use the component/pill pipeline; overflow truncates left text before right-pinned sections
  - Verify: `npx vitest run extensions/pi-statusline/src/render.test.ts extensions/pi-statusline/src/components.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S22 [R12] [D22]: dashboard aborts in-flight commands on `stop()`/shutdown and passes render width to `fitLines`
  - Verify: `npx vitest run extensions/pi-dashboard/src/index.test.ts extensions/pi-dashboard/src/render.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

#### Data & Contracts

- [x] S23 [R13] [D23]: core package version is `0.2.0`; every consumer dependency range is `^0.2.0`
  - Verify: `! rg -l '"@hollowheap/core": "0\.1\.0"' packages`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S24 [R13] [D24]: mode changes append `hollowheap.core.mode`; restore reads `getEntries()`; resume and fork keep the mode
  - Verify: `npx vitest run packages/core/src/state.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S25 [R13] [D25]: config modes load from `<agentDir>/modes.json` (default `~/.pi/agent/modes.json`)
  - Verify: `npx vitest run packages/core/src/config.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S26 [R13] [D26]: `modes.json` validates defaults for all tags, rejects `allow` overrides and name collisions with diagnostics, and reload replaces config layers only
  - Verify: `npx vitest run packages/core/src/config.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S27 [R13] [D27]: restoring a mode re-runs entry gates; a veto restores `ask` with a notice
  - Verify: `npx vitest run packages/core/src/state.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S28 [R14] [D28] [D29] [D30] [D31] [D32] [D33] [D34]: the ACP adapter learns the mode list from the extension, so an extension-registered mode is selectable; a mode notice rides in the returned config option's description
  - Verify: `npx vitest run packages/pi-acp/src/adapter.test.ts packages/pi-acp/src/extension/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

### pi-hooks

#### Module Seams

- [x] S29 [R15] [D35]: a hook runs a command with the tool call JSON on stdin; the verdict comes from stdout, exit code 2, or a failure
  - Verify: `npx vitest run extensions/pi-hooks/src/hooks.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S30 [R15] [D36]: hooks load from `<agentDir>/hooks.json` and, for trusted projects only, `<project>/.pi/hooks.json`
  - Verify: `npx vitest run extensions/pi-hooks/src/config.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S31 [R15] [D37]: a pre-hook can block a call with a reason but never rewrites the tool input
  - Verify: `npx vitest run extensions/pi-hooks/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S32 [R15] [D38]: a post-hook appends its output to the tool result and never replaces the result
  - Verify: `npx vitest run extensions/pi-hooks/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S33 [R15] [D39]: pi-hooks registers no model-callable tool; the bundled skill is the model's only way to configure hooks
  - Verify: `! rg -l "registerTool" extensions/pi-hooks/src`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S34 [R15] [D40]: a pre-hook that fails or times out blocks the call with the failure as the reason
  - Verify: `npx vitest run extensions/pi-hooks/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S35 [R15] [D41]: the bundled skill is disabled by default and contributed through `resources_discover` when `PI_HOOKS_DISCOVER_SKILL=1`
  - Verify: `npx vitest run extensions/pi-hooks/src/index.test.ts`
  - Behavior: `resources_discover` is unregistered by default to minimize prompt noise and registered when `PI_HOOKS_DISCOVER_SKILL=1`
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

### Tool-free question blocks

#### Data & Contracts

- [x] S36 [R17] [D44]: `pi-question` registers no model tool; a live assistant `message_end` parses text content for question blocks and opens dialogs; resumed/replayed messages are not re-asked
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S37 [R17] [D45]: core exports `scanTaggedBlocks(markdown)` returning `{ tag, body, start, end, closed }` for `'''tag` through `'''`; it ignores markdown code fences and handles multiple or unclosed blocks without…
  - Verify: `npx vitest run packages/core/src/blocks.test.ts`
  - Behavior: core exports `scanTaggedBlocks(markdown)` returning `{ tag, body, start, end, closed }` for `'''tag` through `'''`; it ignores markdown code fences and handles multiple or unclosed blocks without throwing
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S38 [R17] [D45]: core exports `parseMarkdownBlocks(body)` returning heading/list/listItem/paragraph nodes with ordered and optional checked state, no inline parsing, and no throw on malformed input
  - Verify: `npx vitest run packages/core/src/blocks.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S39 [R17] [D45]: core's new blocks module is exported from `src/index.ts`, imports no `@earendil-works/*` or `typebox`, and adds no runtime dependency
  - Verify: `! rg -l "@earendil-works|typebox" packages/core/src/blocks.ts && jq -e 'has("dependencies") | not' packages/core/package.json >/dev/null`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S40 [R17] [D46]: the question parser accepts H2 per question and ordered-list options; all checked means multi (checkbox is a mode marker, not preselection), none means single, mixed/9+ options/reserved write-in…
  - Verify: `npx vitest run extensions/pi-question/src/questions.test.ts`
  - Behavior: the question parser accepts H2 per question and ordered-list options; all checked means multi (checkbox is a mode marker, not preselection), none means single, mixed/9+ options/reserved write-in means invalid; zero options is free-text; source order is preserved
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S41 [R17] [D47]: TUI single-select uses `ctx.ui.select` with a final write-in row, then `ctx.ui.input` for write-in; cancellation cancels the whole set
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S42 [R17] [D47]: TUI multi-select uses `ctx.ui.custom` checkbox rows with a final write-in row, toggles with space, submits with Enter, and allows zero selections
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S43 [R17] [D47]: RPC single uses `select`/`input`; RPC multi uses a `select` toggle loop with `[ ]`/`[x]` rows, a write-in row, and Done; zero selections is valid and cancellation cancels the set
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S44 [R17] [D47]: `ctx.hasUI` gates the prompt section and dialogs; print/json add no section and open no dialogs; TUI uses the custom multi-select path and RPC uses the select-loop
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S45 [R17] [D48]: `before_agent_start` sets a stable `sections.question_format` only when `ctx.hasUI`; the section teaches the fence, H2, ordered list, checkbox multi, implicit write-in, 0-8 options, no-tool turn…
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Behavior: `before_agent_start` sets a stable `sections.question_format` only when `ctx.hasUI`; the section teaches the fence, H2, ordered list, checkbox multi, implicit write-in, 0-8 options, no-tool turn ending, and follow-up answers
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S46 [R17] [D49]: the markdown transformer removes valid `question` blocks only in assistant messages; unknown tags and fully closed invalid blocks stay; open fences are removed while streaming; markdown code…
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Behavior: the markdown transformer removes valid `question` blocks only in assistant messages; unknown tags and fully closed invalid blocks stay; open fences are removed while streaming; markdown code fences are ignored
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S47 [R17] [D49]: answers send one `hollowheap.question.answers` message with `display: true` and `deliverAs: "followUp"`, numbered answers only; a registered renderer shows the custom message and tolerates missing…
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Behavior: answers send one `hollowheap.question.answers` message with `display: true` and `deliverAs: "followUp"`, numbered answers only; a registered renderer shows the custom message and tolerates missing details
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S48 [R17] [D50]: cancelling any dialog cancels the whole set, sends no follow-up, and does not throw; no tool fallback exists
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S49 [R17] [D51]: `pi-question` removes the `question` tool and TypeBox/pi-ai imports, adds `@hollowheap/core` at `^0.2.0`, and documents the breaking removal, fence format, display-only TUI strip, RPC behavior,…
  - Verify: `! rg -l "registerTool|defineTool|typebox|@earendil-works/pi-ai|@earendil-works/pi-agent-core" extensions/pi-question/src extensions/pi-question/package.json && rg -q "'''question" extensions/pi-question/README.md`
  - Behavior: `pi-question` removes the `question` tool and TypeBox/pi-ai imports, adds `@hollowheap/core` at `^0.2.0`, and documents the breaking removal, fence format, display-only TUI strip, RPC behavior, and write-in
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S50 [R17] [D52]: `pi-question` ignores unknown tags and fully closed malformed `question` blocks, leaving them visible; only valid question blocks trigger dialogs or stripping; malformed input never crashes
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S51 [R17] [D53]: a question accepts 0-8 options, write-in is capped at 500 characters, questions are asked in source order, zero options uses free-text input, and empty/zero-selection answers are represented…
  - Verify: `npx vitest run extensions/pi-question/src/questions.test.ts`
  - Behavior: a question accepts 0-8 options, write-in is capped at 500 characters, questions are asked in source order, zero options uses free-text input, and empty/zero-selection answers are represented explicitly
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

### pi-todos

#### Data & Contracts

- [x] S52 [R18] [D54]: `extensions/pi-todos` is a pi extension with no model tool, depends on `@hollowheap/core` at `^0.2.0`, and is listed in the root `pi.extensions`
  - Verify: `jq -e '.pi.extensions | index("./extensions/pi-todos/index.ts")' package.json >/dev/null && ! rg -l "registerTool|defineTool|typebox|@earendil-works/pi-ai|@earendil-works/pi-agent-core" extensions/pi-todos/src extensions/pi-todos/package.json`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S53 [R18] [D55]: todo state is a branch-local `hollowheap.todos` custom entry, restored from `getBranch()` on `session_start`/`session_tree`, appended once per changed assistant message, with monotonic IDs and no…
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts`
  - Behavior: todo state is a branch-local `hollowheap.todos` custom entry, restored from `getBranch()` on `session_start`/`session_tree`, appended once per changed assistant message, with monotonic IDs and no global/file state
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S54 [R18] [D56]: `create_todos` parses exactly one ordered list of non-empty task texts, appends in order, assigns stable numeric IDs, and rejects checkboxes, unordered lists, and empty lists
  - Verify: `npx vitest run extensions/pi-todos/src/todos.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S55 [R18] [D56]: `complete_todos` parses exactly one ordered list of positive numeric IDs, marks matching todos done once, ignores unknown IDs with a report, and rejects malformed IDs
  - Verify: `npx vitest run extensions/pi-todos/src/todos.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S56 [R18] [D56]: a changed message sends one `hollowheap.todos.updated` follow-up with full ID list and unknown IDs, and a renderer falls back to content without throwing
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S57 [R18] [D57]: `/todos` lists every todo with ID and done marker; `ctx.ui.setStatus("todos", ...)` shows open/total and clears when empty
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S58 [R18] [D58]: `before_agent_start` adds a stable `sections.todos_format` only when `ctx.hasUI`; the section teaches both fences, ordered lists, numeric IDs, append semantics, confirmation, and no-tool flow;…
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts`
  - Behavior: `before_agent_start` adds a stable `sections.todos_format` only when `ctx.hasUI`; the section teaches both fences, ordered lists, numeric IDs, append semantics, confirmation, and no-tool flow; print/json add no section
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S59 [R18] [D59]: the assistant TUI transformer strips valid closed todo blocks and open todo fences while streaming, leaving unknown tags, closed invalid blocks, non-assistant messages, and code fences visible;…
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts`
  - Behavior: the assistant TUI transformer strips valid closed todo blocks and open todo fences while streaming, leaving unknown tags, closed invalid blocks, non-assistant messages, and code fences visible; stored/RPC text keeps the fence
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S60 [R18] [D54]: malformed and unknown todo blocks never crash or mutate state; only valid closed blocks trigger state changes or display stripping; duplicate `message_end` for the same message is ignored
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts extensions/pi-todos/src/todos.test.ts`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S61 [R18] [D54]: `pi-todos/README.md` documents the fence format, no-tool flow, branch state, `/todos`, status count, TUI-only stripping, RPC raw fence, and print/json gating; the package manifest and root…
  - Verify: `rg -q "'''create_todos" extensions/pi-todos/README.md && rg -q "hollowheap.todos" extensions/pi-todos/README.md && npm test`
  - Behavior: `pi-todos/README.md` documents the fence format, no-tool flow, branch state, `/todos`, status count, TUI-only stripping, RPC raw fence, and print/json gating; the package manifest and root workspace are consistent
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S62 [R18] [D60]: `ctx.ui.setWidget("todos", ...)` shows up to five open todos with IDs above the editor, adds `+N more (/todos)` when capped, omits completed todos, and clears when no open todos remain; restore…
  - Verify: `npx vitest run extensions/pi-todos/src/todos.test.ts extensions/pi-todos/src/index.test.ts`
  - Behavior: `ctx.ui.setWidget("todos", ...)` shows up to five open todos with IDs above the editor, adds `+N more (/todos)` when capped, omits completed todos, and clears when no open todos remain; restore and every state change update it
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

### pi-language-tools

#### Module Seams

- [x] S63 [R19] [D61]: `extensions/pi-language-tools` is a pi extension with one `lang` tool exposed through codemode, depends on `@hollowheap/core` at `^0.2.0`, and is listed in the root `pi.extensions`
  - Verify: `jq -e '.pi.extensions | index("./extensions/pi-language-tools/index.ts")' package.json >/dev/null && jq -e '.dependencies["@hollowheap/core"] == "^0.2.0"' extensions/pi-language-tools/package.json >/dev/null && rg -q 'name: "lang"' extensions/pi-language-tools/src && rg -q 'exposure: "codemode"' extensions/pi-language-tools/src && ! rg -q 'typebox' extensions/pi-language-tools/package.json`
  - Seam: (not specified)
  - Behavior: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S64 [R19] [D62]: the LSP client uses Node builtins over stdio, frames JSON-RPC with Content-Length, lazily pools one server per command/args/root, applies request timeouts, synchronizes open documents from disk,…
  - Verify: `npx vitest run extensions/pi-language-tools/src/lsp.test.ts`
  - Behavior: the LSP client uses Node builtins over stdio, frames JSON-RPC with Content-Length, lazily pools one server per command/args/root, applies request timeouts, synchronizes open documents from disk, and kills every server on session shutdown
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S65 [R19] [D63]: built-in language mappings are overlaid by `<agentDir>/language-tools.json`; malformed entries are diagnosed and dropped; servers spawn only in trusted projects, never auto-install, and missing…
  - Verify: `npx vitest run extensions/pi-language-tools/src/config.test.ts extensions/pi-language-tools/src/tool.test.ts`
  - Behavior: built-in language mappings are overlaid by `<agentDir>/language-tools.json`; malformed entries are diagnosed and dropped; servers spawn only in trusted projects, never auto-install, and missing commands return a setup hint
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S66 [R19] [D64] [D140]: `lang` supports `definition`, `references`, `document_symbols`, `workspace_symbols`, `hover`, `signature_help`, `type_definition`, `implementation`, `document_highlights`, and `diagnostics`; positions are 1-based; results are capped, formatted, and filtered with core read/search rules;…
  - Verify: `npx vitest run extensions/pi-language-tools/src/tool.test.ts extensions/pi-language-tools/src/lsp.test.ts`
  - Behavior: `lang` supports navigation, hover, signature help, type/implementation, highlights, and diagnostics; positions are 1-based; results are capped, formatted, and filtered with core read/search rules; diagnostics use pull or push LSP support; validation and server failures return text
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S67 [R19] [D61]: `pi-language-tools/README.md` documents actions, 1-based positions, built-in mappings, config schema, trust gating, no auto-install, and codemode exposure; the package manifest, root extension list,…
  - Verify: `rg -q "lang" extensions/pi-language-tools/README.md && npm test && npm run typecheck && npm run lint`
  - Behavior: `pi-language-tools/README.md` documents actions, 1-based positions, built-in mappings, config schema, trust gating, no auto-install, and codemode exposure; the package manifest, root extension list, and lock are consistent; the full suite is green
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

### pi-tasks

#### System Shape

- [x] S68 [R20] [D65] [D66] [D72]: `extensions/pi-tasks` is a pi extension listed in the root `pi.extensions`, depends on `@hollowheap/core` at `^0.2.0` with no `typebox` dependency, registers the direct `task` tool (`exposure`…
  - Verify: `jq -e '.pi.extensions | index("./extensions/pi-tasks/index.ts")' package.json >/dev/null && jq -e '.dependencies["@hollowheap/core"] == "^0.2.0"' extensions/pi-tasks/package.json >/dev/null && ! rg -q 'typebox|exposure: "codemode"' extensions/pi-tasks/src extensions/pi-tasks/package.json`
  - Behavior: `extensions/pi-tasks` is a pi extension listed in the root `pi.extensions`, depends on `@hollowheap/core` at `^0.2.0` with no `typebox` dependency, registers the direct `task` tool (`exposure` omitted/direct) without overriding built-in `bash`, and is inactive under ACP (`-ne` omits it and `pi-acp` keeps `acp_bash`); `pi-tools` stays stateless and core gains no process or host code
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S69 [R20] [D70] [D71]: the generic task registry exports `TaskRecord { id, kind, status, command?, cwd, pid?, startTime?, startedAt, finishedAt?, exitCode?, output, wait, cancel }` (`kind: "shell"` in v1, session-scoped…
  - Verify: `npx vitest run extensions/pi-tasks/src/registry.test.ts`
  - Behavior: the generic task registry exports `TaskRecord { id, kind, status, command?, cwd, pid?, startTime?, startedAt, finishedAt?, exitCode?, output, wait, cancel }` (`kind: "shell"` in v1, session-scoped subagents reserved for parent-hub RPC without `inbox`/`outbox` in v1) and persists durable shell tasks under `<agentDir>/tasks/<id>.json` and `<agentDir>/tasks/<id>.log` with `0600` permissions (`0700` dir)
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S70 [R20] [D69]: durable shell tasks spawn via a detached Node runner shim that streams stdout/stderr to `<id>.log` and atomically writes `status`, `exitCode`, and `finishedAt` to `<id>.json` on exit;…
  - Verify: `npx vitest run extensions/pi-tasks/src/runner.test.ts extensions/pi-tasks/src/registry.test.ts`
  - Behavior: durable shell tasks spawn via a detached Node runner shim that streams stdout/stderr to `<id>.log` and atomically writes `status`, `exitCode`, and `finishedAt` to `<id>.json` on exit; `list`/`status`/`wait` reconcile dead shims using recorded `pid` plus OS process start time to prevent PID-reuse false positives, and `session_shutdown` leaves durable tasks running
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S71 [R20] [D67] [D74]: `extensions/pi-guard` gates `task` tool calls: when `action === "start"` (or unknown/missing action), it evaluates `command` under `tag: "shell"` (prompting via `ctx.ui.confirm` on `"ask"` and…
  - Verify: `npx vitest run extensions/pi-guard/src/index.test.ts`
  - Behavior: `extensions/pi-guard` gates `task` tool calls: when `action === "start"` (or unknown/missing action), it evaluates `command` under `tag: "shell"` (prompting via `ctx.ui.confirm` on `"ask"` and blocking on `"deny"`), while allowing read/control actions (`"list"`, `"status"`, `"wait"`, `"cancel"`) without an unnecessary shell prompt
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S72 [R20] [D66] [D67] [D68] [D69]: the direct `task` tool supports `action: "start" | "list" | "status" | "wait" | "cancel"`, where `start` requires `ctx.isProjectTrusted()` and a non-empty `command` (checked against core shell…
  - Verify: `npx vitest run extensions/pi-tasks/src/task-tool.test.ts`
  - Behavior: the direct `task` tool supports `action: "start" | "list" | "status" | "wait" | "cancel"`, where `start` requires `ctx.isProjectTrusted()` and a non-empty `command` (checked against core shell permissions in `effectiveCwd`), spawns the detached runner shim, and returns task `id`/`pid`/log path immediately; `list` returns reconciled tasks; `status` returns metadata and tail output bounded by `truncateText`; `wait` blocks until task exit or `timeoutMs` (including across pi restarts by watching/polling `<id>.json`); `cancel` terminates the process group and marks the task `cancelled`; completion never triggers a model turn
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S73 [R20] [D65] [D68] [D69] [D72]: `extensions/pi-tasks/src/index.ts` registers only the direct `task` tool (no `bash` override or `/background` command), updates `ctx.ui.setStatus("tasks", "<n> running")` when non-zero (cleared when…
  - Verify: `npx vitest run extensions/pi-tasks/src/index.test.ts`
  - Behavior: `extensions/pi-tasks/src/index.ts` registers only the direct `task` tool (no `bash` override or `/background` command), updates `ctx.ui.setStatus("tasks", "<n> running")` when non-zero (cleared when `0`), stays inert when `PI_ACP` is set, and leaves durable tasks running on `session_shutdown`
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

- [x] S74 [R20] [D65] [D66] [D67] [D68] [D69] [D70] [D71] [D72]: `extensions/pi-tasks/README.md` documents the direct `task` tool (`start`/`list`/`status`/`wait`/`cancel`), keeping built-in `bash` untouched, `pi-guard` shell gating on `task.start`, the…
  - Verify: `rg -q "pi-tasks" README.md && rg -q "start" extensions/pi-tasks/README.md && npm test && npm run typecheck && npm run lint`
  - Behavior: `extensions/pi-tasks/README.md` documents the direct `task` tool (`start`/`list`/`status`/`wait`/`cancel`), keeping built-in `bash` untouched, `pi-guard` shell gating on `task.start`, the `<agentDir>/tasks/` `0600` durability and PID+start-time reconciliation model, the project trust gate, ACP inactivity, and the v1 task-layer scope; root `README.md`, `package.json`, and workspace lock are consistent and the full suite is green
  - Seam: (not specified)
  - Failures: The Verify command and its tests fail when this invariant breaks.

### pi-web

#### Framework & Library Choices

- [x] S75 [R01] [D76]: `pi-web` package registers exactly `web_search` and `web_fetch` as direct tools and is loaded by the suite.
  - Verify: `npx vitest run extensions/pi-web/src/index.test.ts && npm run typecheck`
  - Seam: package entry and root suite entry.
  - Behavior: both tools direct; no other tools, commands, or UI; standalone install works.
  - Failures: missing registration, extra tools, codemode exposure, suite omission.

- [x] S76 [R01] [D77]: Both web tools declare direct exposure and never activate codemode.
  - Verify: `npx vitest run extensions/pi-web/src/index.test.ts`
  - Seam: tool registration and session startup.
  - Behavior: direct tools appear without activating codemode; no `codemode` calls.
  - Failures: hidden registration, codemode activation, missing tool schema.

- [x] S77 [R02] [D78]: Provider adapters expose normalized search and fetch results across Tavily, Exa, and Firecrawl capabilities.
  - Verify: `npx vitest run extensions/pi-web/src/providers`
  - Seam: provider adapter boundary consumed by both tools.
  - Behavior: Tavily searches/extracts; Exa searches/reads contents; Firecrawl searches only; raw HTTP is fetch fallback.
  - Failures: provider payload drift, missing capability, adapter leaking provider-specific shape.

- [x] S78 [R02] [D79]: `web_search` and `web_fetch` return the normalized fields and enforce result, character, link, and media caps.
  - Verify: `npx vitest run extensions/pi-web/src/tools.test.ts`
  - Seam: tool input/output contract.
  - Behavior: search `title/url/snippet/provider`, 5 default/10 max; fetch `url/finalUrl/provider/contentType/content/links/media/truncated`, 20k/100k chars, 50 links, 20 media.
  - Failures: missing fields, uncapped output, wrong truncation flag, invalid parameters throwing.

- [x] S79 [R04] [D80]: Provider selection auto-detects env keys, uses the cheapest-first order, and falls through on failure.
  - Verify: `npx vitest run extensions/pi-web/src/providers/selection.test.ts`
  - Seam: provider resolver behind both tools.
  - Behavior: search Exa, Tavily, Firecrawl; fetch Exa, Tavily, raw; first order entry is default; `web.json` order overrides; 15s timeout.
  - Failures: selecting an unkeyed provider, stopping after a failed provider, ignoring config order.

- [x] S80 [R04] [D81]: `web.json` contains only search/fetch order arrays; keys come only from `TAVILY_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`.
  - Verify: `npx vitest run extensions/pi-web/src/config.test.ts`
  - Seam: `<agentDir>/web.json` and env loading.
  - Behavior: order arrays validated; unknown provider names diagnosed; any `keys` field is ignored with a diagnostic; env keys never logged.
  - Failures: accepting keys from JSON, accepting invalid order entries, leaking keys in errors.

- [x] S81 [R03] [D82]: `web_fetch` uses Exa, Tavily, then raw static HTTP extraction; no JS rendering or browser.
  - Verify: `npx vitest run extensions/pi-web/src/fetch.test.ts extensions/pi-web/src/extract.test.ts`
  - Seam: fetch provider chain and raw fallback extractor.
  - Behavior: static HTML yields readable Markdown/text, title, links, and media; text/plain passes through; JS-only pages may be incomplete.
  - Failures: invoking a browser, returning raw HTML, dropping content-type handling.

- [x] S82 [R05] [D83]: `web_fetch` accepts only public `http`/`https` URLs, blocks private targets on every redirect, and caps redirects at 5.
  - Verify: `npx vitest run extensions/pi-web/src/url.test.ts`
  - Seam: URL validation and redirect policy.
  - Behavior: rejects loopback, private, link-local, metadata, non-http(s), and credentialed URLs; revalidates each redirect hop; DNS rebinding remains deferred.
  - Failures: allowing a private redirect target, following unlimited redirects, accepting `file:` or `ftp:`.

- [x] S83 [R06] [D84]: `pi-guard` tags `web_search` as `search` and `web_fetch` as `read`, with built-ins authoritative.
  - Verify: `npx vitest run extensions/pi-guard/src/index.test.ts`
  - Seam: guard built-in tool tag map.
  - Behavior: both tools use the existing path/search policy without user config; user `tools` entries cannot override them.
  - Failures: falling into unknown-tool approval, allowing user override, missing tags.

- [x] S84 [R07] [D85]: README and root docs cover providers, env keys, order arrays, shapes, caps, media, and no rendering.
  - Verify: `rg -q "TAVILY_API_KEY" extensions/pi-web/README.md && rg -q "pi-web" README.md`
  - Seam: package README, root package table, suite docs.
  - Behavior: documents three keyed providers, raw fallback, free-tier caveats, env names, order arrays, output shapes, caps, media metadata, and no-rendering limitation.
  - Failures: stale provider list, missing key names, undocumented caps or security limits.

- [x] S85 [R02] [R03] [D86]: No response cache: identical `web_search` and `web_fetch` calls invoke providers again.
  - Verify: `npx vitest run extensions/pi-web/src/tools.test.ts`
  - Seam: tool execution.
  - Behavior: no module-level cache; session transcript remains the only reuse path.
  - Failures: hidden cache, stale results across calls, cache crossing sessions.

- [x] S86 [R03] [D87]: `web_fetch` returns Markdown plus links (cap 50) and media metadata (cap 20), never binary payloads.
  - Verify: `npx vitest run extensions/pi-web/src/tools.test.ts`
  - Seam: fetch result content.
  - Behavior: images/video/audio/PDF produce `{url,kind,alt?,mimeType?}`; content is Markdown/text; no image blocks or downloads.
  - Failures: returning base64, downloading media, exceeding caps, misclassifying media kind.

- [x] S153 [R72] [D155]: `web_fetch` resolves each hostname and rejects private, loopback, link-local, and metadata CIDR addresses on the initial request and every redirect.
  - Verify: `npx vitest run extensions/pi-web/src/url.test.ts extensions/pi-web/src/fetch.test.ts`
  - Seam: URL safety before connection and on every redirect.
  - Behavior: DNS answers are checked against private and reserved CIDRs; `localtest.me`/`nip.io` are rejected; redirects re-resolve and re-check; failure returns explanatory text without fetching.
  - Failures: literal-host-only checks, DNS rebinding, private redirect fetch, unchecked IPv6 or IPv4.

- [x] S154 [R72] [D155]: `web_fetch` caps response-body bytes while reading and cancels non-OK or redirect bodies before buffering the full response.
  - Verify: `npx vitest run extensions/pi-web/src/fetch.test.ts`
  - Seam: HTTP response read and cancellation.
  - Behavior: body reads stop at the configured cap; non-OK and redirect bodies are canceled; truncation is reported; no whole-body buffering before the cap.
  - Failures: unbounded memory, uncanceled bodies, ignored cap, missing truncation flag.

- [x] S155 [R72] [D155]: Provider fallback advances when a provider returns no results or no relevant result, instead of stopping at the first empty result.
  - Verify: `npx vitest run extensions/pi-web/src/providers/selection.test.ts extensions/pi-web/src/tools.test.ts`
  - Seam: provider selection and fallback.
  - Behavior: an empty result advances to the next provider; final empty returns empty; errors and configured order remain unchanged.
  - Failures: first empty stops fallback, fallback only on errors, duplicate providers, ignored order.

### Codemode tool exposure

#### Module Seams

- [x] S87 [R16] [D42] [D43] [D73]: `fd`/`rg` register as codemode tools and can be activated on session start
  - Verify: `npx vitest run extensions/pi-tools/src/index.test.ts`
  - Seam: tool exposure and session activation.
  - Behavior: both register with codemode exposure; activation runs only when registered and inactive; tool_search stays disabled.
  - Failures: missing exposure, duplicate activation, or enabling tool_search.

### pi-decide

#### Data & Contracts

- [x] S88 [R23] [D88]: `decide` accepts one choice/score/bool question and returns a structured label/score/probability with confidence
  - Verify: `npx vitest run extensions/pi-decide/src/index.test.ts extensions/pi-decide/src/decide.test.ts`
  - Seam: `decide` tool input/output.
  - Behavior: `choice` 2–10 options returns label/probabilities; `score` 2–10 levels returns index/label; `bool` returns probability; all return model and optional usage.
  - Failures: invalid kind, missing or >10 labels, malformed descriptions, missing input/question.

- [x] S89 [R24] [D89]: `decide` requires an explicit `provider/model-id` in `decide.json` and never falls back to another classifier
  - Verify: `npx vitest run extensions/pi-decide/src/config.test.ts`
  - Seam: agent-dir config and model resolution.
  - Behavior: validates `model`, `timeoutMs`, `maxInputChars`, `cacheTtlMs`; missing or invalid model produces explanatory error text.
  - Failures: first-available fallback, malformed model id, wrong model type, unconfigured auth.

- [x] S90 [R25] [D90]: `decide` enforces the configured input cap and timeout and reports capability failures as text
  - Verify: `npx vitest run extensions/pi-decide/src/decide.test.ts`
  - Seam: tool execution failure boundary.
  - Behavior: rejects oversize input, aborts at deadline, returns classifier `stopReason`/`errorMessage`, never mutates session state.
  - Failures: provider error, abort, timeout, missing config, unavailable auth.

- [x] S91 [R26] [D91]: Successful `decide` results are cached per session and concurrent identical requests share one in-flight call
  - Verify: `npx vitest run extensions/pi-decide/src/decide.test.ts`
  - Seam: classifier request cache.
  - Behavior: key includes model/kind/question/criteria/input; TTL from config; failures and aborts are not cached.
  - Failures: stale result after TTL, cache key collision, duplicate concurrent provider calls.

- [x] S92 [R27] [D92]: `pi-decide` registers one direct `decide` tool, adds no CLI/service/codemode activation, and documents advisory use
  - Verify: `npx vitest run extensions/pi-decide/src/index.test.ts && rg -q "decide" extensions/pi-decide/README.md`
  - Seam: package entry and tool exposure.
  - Behavior: direct tool only; no `pi-guard` dependency, no service registry, no CLI bin.
  - Failures: hidden/codemode exposure, extra tools, service registration, missing docs.

- [x] S93 [R28] [D93]: `decide` sends only caller-supplied input, question, and criteria to the classifier
  - Verify: `npx vitest run extensions/pi-decide/src/decide.test.ts`
  - Seam: classifier payload construction.
  - Behavior: `state` contains input only; `questions` contains question and labels; no cwd/mode/session/files/tool output.
  - Failures: automatic context enrichment, file reads, hidden session data, undocumented redaction.

### Process-wide prompt queue

#### System Shape

- [x] S94 [R29] [D94]: Core exposes one process-wide FIFO prompt queue; every blocking dialog or confirmation runs through it and releases the queue when it settles
  - Verify: `npx vitest run packages/core/src/prompt-lock.test.ts extensions/pi-question/src/index.test.ts extensions/pi-guard/src/index.test.ts`
  - Seam: `@hollowheap/core` prompt-lock helper consumed by each blocking prompt owner.
  - Behavior: one queue per process shared across extension module roots; callers acquire in FIFO order; release on resolve, rejection, cancellation, or throw; nested acquisition is rejected instead of deadlocking; status, widgets, headers, and todo views never acquire.
  - Failures: overlapping prompts, a waiter lost on rejection, a duplicate queue per extension module, reentrant deadlock, or a non-prompt UI surface serialized.

### pi-subagents

#### System Shape

- [x] S95 [R30] [D95]: Detached child runner owns stdio and a live socket; state, logs, and session persist under the agent dir
  - Verify: `npx vitest run extensions/pi-subagents/src/runner.test.ts extensions/pi-subagents/src/socket.test.ts`
  - Seam: parent `subagent` tool and per-child runner/control socket.
  - Behavior: start detaches; a later parent reattaches and steers; parent exit leaves the child running; no central daemon.
  - Failures: duplicate runner, orphaned child, missing socket, stale state, or a child that cannot be reattached.

- [x] S96 [R30] [D96]: Direct `subagent` actions are start/list/status/send/wait/cancel/resume; one child per start
  - Verify: `npx vitest run extensions/pi-subagents/src/tool.test.ts`
  - Seam: direct tool schema and action semantics.
  - Behavior: `send` steers a running child or prompts an idle one; `wait` is bounded; `cancel` terminates the group; `resume` is explicit; no parallel-array parameter.
  - Failures: invalid action, unknown id, duplicate live child for one id, or a start that returns before state is durable.

- [x] S97 [R31] [D97]: `subagents.json` validates concurrency, depth, timeout, and lock-wait limits with safe defaults
  - Verify: `npx vitest run extensions/pi-subagents/src/config.test.ts`
  - Seam: agent-dir config loader.
  - Behavior: `maxConcurrent` 4/8, `maxDepth` 1/3, `defaultTimeoutMs` 30m/24h/0, `writeLockTimeoutMs` 30s; invalid values diagnose and fall back.
  - Failures: malformed JSON, out-of-range values, secret fields, or silent defaults.

- [x] S98 [R31] [D98]: write/edit/bash acquire one cross-process per-tool lock with stale-owner recovery
  - Verify: `npx vitest run extensions/pi-subagents/src/write-lock.test.ts`
  - Seam: child-side tool lock boundary.
  - Behavior: atomic lock directory records owner PID/start time; release on result, error, abort, or timeout; stale owners are reclaimed; read-only tools never acquire.
  - Failures: two writers, lost release, stale lock forever, lock timeout, or a denied call that never releases.

- [x] S99 [R32] [D99]: Agent discovery loads user agents and trusted project agents with frontmatter overrides
  - Verify: `npx vitest run extensions/pi-subagents/src/agents.test.ts`
  - Seam: agent discovery and trust boundary.
  - Behavior: user agents always load; project agents only when trusted; project overrides user by name; name/description/tools/model/thinking parse; missing model inherits parent.
  - Failures: project agents in untrusted repos, invalid frontmatter, duplicate names, or silent tool widening.

- [x] S100 [R33] [D100]: Subagent state and sockets are permissioned, trust-gated, guard-loaded, and secret-free
  - Verify: `npx vitest run extensions/pi-subagents/src/state.test.ts`
  - Seam: subagent state, socket, trust, and child policy.
  - Behavior: directory `0700`; JSON/log/session/socket `0600`; start requires trust; child loads guard/core; no API keys; records agent/task/status/PID/start/socket/session/attempt.
  - Failures: loose permissions, untrusted start, guard bypass, key leakage, or missing reconciliation fields.

- [x] S101 [R33] [D101]: Resume is explicit, reuses the logical id and session, increments attempt, and never auto-resumes
  - Verify: `npx vitest run extensions/pi-subagents/src/resume.test.ts`
  - Seam: recovery action.
  - Behavior: failed child resumes from its session file with a new runner/socket and incremented attempt; untrusted resume is denied.
  - Failures: auto-resume, duplicate live child, attempt reset, or resume after a successful/aborted run.

- [x] S102 [R34] [D102]: READMEs document config, agents, actions, state/socket, trust, depth, locks, recovery, ACP, and limitations
  - Verify: `rg -q "maxConcurrent" extensions/pi-subagents/README.md && rg -q "pi-subagents" README.md`
  - Seam: package and root documentation.
  - Behavior: users can audit limits, storage, trust, write locking, recovery, ACP inactivity, and the shared process package.
  - Failures: stale defaults, missing key path, undocumented survival/cleanup, or no ACP limitation.

### Process package

#### System Shape

- [x] S103 [R35] [D103]: `@hollowheap/runtime` is a Node-only library exporting detached lifecycle and socket primitives
  - Verify: `npx vitest run packages/runtime/src/index.test.ts`
  - Seam: package exports and host independence.
  - Behavior: no Pi host imports; exports spawn, state, log, cancel, and Unix socket server/client primitives.
  - Failures: host coupling, missing export, or a second lifecycle implementation.

- [x] S104 [R35] [D104]: Process state/socket uses `0700`/`0600`, atomic state, PID/start-time, and JSONL envelopes
  - Verify: `npx vitest run packages/runtime/src/state.test.ts packages/runtime/src/socket.test.ts`
  - Seam: process state files and Unix socket transport.
  - Behavior: state writes are atomic; PID/start time recorded; directory `0700`; files/socket `0600`; one `{id,action,payload}` JSON object per line.
  - Failures: partial writes, wrong permissions, framing loss, missing request correlation, or stale owner reuse.

- [x] S105 [R35] [D105]: `pi-subagents` is a new extension; `pi-tasks` migrates to the shared process layer with no duplicate runner
  - Verify: `npx vitest run extensions/pi-tasks/src/runner.test.ts extensions/pi-subagents/src/index.test.ts`
  - Seam: package ownership and dependency graph.
  - Behavior: `pi-subagents` owns the parent tool, agents, write lock, child RPC, and generic harnesses; `pi-tasks` owns the shared atomic task store and detached-spawn lifecycle consumed by both shell tasks and subagents.
  - Failures: duplicate state lock or spawn lifecycle, missing workspace dependency, task regression, or subagent tool in the task package.

### ACP inactivity

#### System Shape

- [x] S106 [R33] [D106]: `pi-subagents` registers no tool and starts no children when `PI_ACP` is set
  - Verify: `npx vitest run extensions/pi-subagents/src/index.test.ts`
  - Seam: extension registration under ACP.
  - Behavior: ACP sessions keep subagents inactive; no local child process is spawned.
  - Failures: tool visible under ACP, local child startup, or ACP execution bypass.

### UI and context

#### Module Seams

- [x] S107 [R36] [D75] [D107]: `pi-todos` renders tasks in a sticky widget above prompt box alongside subagents; no statusline segment
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts extensions/pi-todos/src/todos.test.ts`
  - Seam: `pi-todos` UI widget and extension state.
  - Behavior: `create_todos`/`complete_todos` tagged blocks update a sticky widget above the editor displaying open todos and subagent execution states (running, blocked, complete); no statusline segment is set.
  - Failures: empty todo list clearing the section, malformed blocks, out-of-order IDs, or subagent state collision.

#### Operations & Security

- [x] S108 [R37] [D108]: `/context` in `pi-guard` outputs token counts by category against the window limit without a UI extension
  - Verify: `npx vitest run extensions/pi-guard/src/context.test.ts`
  - Seam: `pi-guard` slash-command registration and token accounting.
  - Behavior: running `/context` breaks down session tokens into thinking, agent output, user input, tool output, tool input, system prompt, and skills, reporting per-category counts and total usage against the model context limit.
  - Failures: unknown model context limits, empty session, malformed message parts, or missing token counts.

- [x] S109 [R38] [D109]: `pi-guard` gates out-of-workspace file paths against user-trusted roots, falling back to ask with session or indefinite persistence
  - Verify: `npx vitest run extensions/pi-guard/src/rules.test.ts`
  - Seam: `pi-guard` path rule evaluation and approval prompt.
  - Behavior: file operations target paths outside workspace roots; trusted roots allow without prompt; untrusted paths prompt user with allow/ask/deny and session vs indefinite persistence scopes, saving decisions to guard config.
  - Failures: path traversal attacks, relative path escapes, invalid persistence scopes, or denied access throwing errors.

### Budgets and usage

#### Data & Contracts

- [x] S110 [R39] [D110]: `pi-budgets` reads provider pricing and enforces budget caps in dollars
  - Verify: UNVERIFIED: `npx vitest run extensions/pi-budgets/src/budget.test.ts`
  - Seam: `pi-budgets` pricing resolver and budget enforcement.
  - Behavior: calculates dollar costs from token usage using provider pricing metadata for the configured model, rejecting turns when cumulative cost reaches or exceeds the configured dollar cap.
  - Failures: missing provider pricing, non-numeric price data, zero caps, or token-count overflow.

- [x] S111 [R39] [D111]: `pi-usage` persists token counts and dollar cost in session custom entries across compaction
  - Verify: `npx vitest run extensions/pi-usage/src/index.test.ts`
  - Seam: `pi-usage` extension entry and session branch custom entries (`hollowheap.usage`).
  - Behavior: records running token counts and cumulative dollar costs per turn; recovers baseline usage on session start and after context compaction from stored entries.
  - Failures: corrupted custom entries, unrecorded compaction events, concurrent branch updates, or negative usage deltas.

### Modal, agent, and feature expansions

#### Framework & Library Choices

- [x] S112 [R40] [D112]: `pi-modal` provides a `CustomEditor` with Vim normal, insert, and visual modes, loading overrides from global `~/.pi/agent/modal.json`
  - Verify: `npx vitest run extensions/pi-modal/src/index.test.ts`
  - Seam: `pi-modal` extension registration and CustomEditor implementation.
  - Behavior: intercepts keystrokes in normal, insert, and visual modes; displays current mode badge; applies keybinding overrides defined exclusively in global `~/.pi/agent/modal.json`.
  - Failures: unhandled key combinations, missing or invalid `modal.json` syntax, editor buffer desynchronization, or unhandled exit/submit events.

#### Module Seams

- [x] S113 [R41] [D113]: `pi-subagents` pre-flights subagent model availability against runtime models and prompts interactive swap via `ctx.ui.select`
  - Verify: `npx vitest run extensions/pi-subagents/src/swap.test.ts`
  - Seam: `pi-subagents` spawn pre-flight and model selection prompt.
  - Behavior: checks whether subagent frontmatter model is accessible in Pi's runtime models; on failure, prompts user with available model choices using `ctx.ui.select` falling back to session model; ignores any caller tool model overrides.
  - Failures: unhandled interactive cancellation, missing model registry, caller tool parameter hijacking subagent model, or unhandled spawn errors.

#### Framework & Library Choices

- [x] S114 [R42] [D114]: `pi-web` exposes `web_search` and `web_fetch` exclusively with `exposure: "codemode"` and pricing calculates `:free` models as $0.00
  - Verify: `npx vitest run extensions/pi-web/src/tools.test.ts packages/core/src/pricing.test.ts`
  - Seam: `pi-web` tool registration and `packages/core/src/pricing.ts`.
  - Behavior: registers `web_search` and `web_fetch` strictly with `exposure: "codemode"` (no direct tool exposure); `resolveModelPricing` and `calculateDollarCost` treat models ending with `:free` as $0.00 per token.
  - Failures: direct prompt exposure, non-zero pricing for free models, or NaN cost results.

#### Module Seams

- [x] S115 [R43] [D115]: `pi-agent` implements `/agent` with agent discovery, auto-forking, branch labeling, skill filtering, and overlay modal
  - Verify: `npx vitest run extensions/pi-agent/src/index.test.ts extensions/pi-agent/src/agents.test.ts extensions/pi-agent/src/popup.test.ts`
  - Seam: `extensions/pi-agent` package, `/agent` command, `ctx.fork`, and `before_agent_start`.
  - Behavior: discovers markdown agents in `<agentDir>/agents/*.md` and `<project>/.pi/agents/*.md`; parses frontmatter (name, description, tools, skills, model, thinking, mode, effort, system prompt); auto-forks ongoing sessions with history via `ctx.fork` and sets session name `[<agent>] ...` and label `agent: <name>`; filters `event.systemPromptOptions.skills` to match agent's `skills` array (or keeps all if unset/'all'); injects `systemPrompt` into `event.systemPromptOptions.sections.agent`; displays modal popup via `ctx.ui.custom({ overlay: true })`; `/agent default` or `/agent reset` restores default settings.
  - Failures: invalid agent markdown frontmatter, missing agent file, unknown skill names in filter, fork failures on initial empty sessions (handled by in-place fallback).

#### Operations & Security

- [x] S116 [R44] [D116]: `pi-guard` gates subagent execution actions by mode while passing read-only actions, subagents inherit parent mode, and `pi-todos` renders elapsed time and active tool duration
  - Verify: `npx vitest run extensions/pi-guard/src/index.test.ts extensions/pi-subagents/src/tool.test.ts extensions/pi-todos/src/todos.test.ts`
  - Seam: `pi-guard` `TOOL_TAGS` and `PASSTHROUGH_ACTIONS`, `pi-subagents` tool `start` & child `session_start`/tool hooks, and `pi-todos` `formatTodoWidget`.
  - Behavior: `pi-guard` treats `subagent` with `action` in `list`, `status`, `wait`, `cancel` as passthrough; execution actions follow mode permissions; subagent `start` resolves `effectiveMode` prioritizing parent mode != `"ask"`, falling back to frontmatter `mode ?? "ask"`; child tracks `activeTool` and `activeToolStartedAt`; `pi-subagents` emits `subagents:state` with active ticker; `pi-todos` formats `@<id> <elapsed> (<task>) <state> · <tool> <tool_duration>`.
  - Failures: read-only actions blocked in plan/ask mode, parent autopilot overridden by frontmatter ask, missing tool timing on subagent state emission, or ticker leak on shutdown.

#### Module Seams

- [x] S117 [R45] [D117]: `pi-statusline` renders compact budget usage/cap while `pi-budgets` provides breakdown without footer status pollution
  - Verify: UNVERIFIED: `npx vitest run extensions/pi-budgets/src/budget.test.ts extensions/pi-statusline/src/components.test.ts`
  - Seam: `pi-budgets` event emission and `pi-statusline` `budgets` component.
  - Behavior: `pi-budgets` emits `statusline:values` with compact text: `$0.012` when no dollar cap is set, or `$0.012/$1.000` when cap is active; `ctx.ui.setStatus("budget")` is silenced; `/budget` command displays full breakdown of input/output tokens, dollar cost, and caps.
  - Failures: statusline showing verbose prose, missing cap ratio, footer status reappearing, or division by zero.

#### Framework & Library Choices

- [x] S118 [R46] [D118]: `ModalEditor` visually highlights text selection in visual mode and supports yank, cut, and change operations
  - Verify: `npx vitest run extensions/pi-modal/src/index.test.ts`
  - Seam: `extensions/pi-modal` CustomEditor implementation and keybinding dispatch.
  - Behavior: pressing `v` activates visual mode setting anchor; movement keys (`h`, `j`, `k`, `l`, `0`, `$`, `w`, `b`) move cursor and expand highlighted selection; `y` copies selection to clipboard returning to normal mode; `d`/`x` cuts selection returning to normal mode; `c` cuts selection and transitions to insert mode; `escape` cancels selection.
  - Failures: unhighlighted visual selection, cursor desynchronization, lost yank content, or unhandled mode transitions.

- [x] S119 [R47] [D119]: `pi-modal` decorates prompt with customizable single-char prefix and UI components adopt rounded box corners
  - Verify: `npx vitest run extensions/pi-modal/src/index.test.ts extensions/pi-todos/src/todos.test.ts extensions/pi-agent/src/popup.test.ts`
  - Seam: `extensions/pi-modal` prompt renderer and `formatTodoWidget`/`renderAgentPopup` border characters.
  - Behavior: `modal.json` supports `promptChar` (single character, default `❯`) rendered before input; `formatTodoWidget` and `renderAgentPopup` render frames with rounded box corners (`╭`, `╮`, `╯`, `╰`) and divider branches (`├`, `┤`).
  - Failures: multi-character prompt strings overflowing column alignment, mismatched corner characters, or border style regressions.

#### Operations & Security

- [x] S120 [R48] [D120]: Bubblewrap sandbox wraps shell commands with unprivileged namespace isolation and workspace-only writable mounts
  - Verify: `npx vitest run packages/core/src/sandbox.test.ts`
  - Seam: `packages/core` shell execution / sandboxing primitives and `bwrap` CLI invocation.
  - Behavior: shell commands run through `bwrap` with `--ro-bind / /`, `--dev /dev`, `--proc /proc`, `--tmpfs /tmp`, and `--bind <cwd> <cwd>`; masks sensitive directories (`~/.ssh`, `~/.gnupg`); passes network unless offline specified; fails closed with clear error if `bwrap` is missing.
  - Failures: host filesystem leakage, writable root escapes, unmasked credentials, or silent un-sandboxed fallback.

#### Data & Contracts

- [x] S121 [R49] [D121]: `pi-todos` rejects assistant `delete_todos` when incomplete items exist and exposes `/todo complete <id>` and `/todo delete [id]`
  - Verify: `npx vitest run extensions/pi-todos/src/todos.test.ts extensions/pi-todos/src/index.test.ts`
  - Seam: `extensions/pi-todos` block parser and slash-command handlers.
  - Behavior: `'''delete_todos` block execution succeeds only when every existing todo has `done: true`, clearing the list; rejected if any open todo remains; user `/todo complete <id>` marks specific todo done; `/todo delete <id>` deletes single todo immediately; `/todo delete` clears completed todos.
  - Failures: assistant deleting open tasks, invalid ID errors throwing uncaught exceptions, or out-of-sync widget counts.

- [x] S122 [R50] [D122]: `pi-todos` toggles sticky panel visibility via `^x p` prefix chord and `/panel toggle` command, formatting tasks and subagents symmetrically
  - Verify: `npx vitest run extensions/pi-todos/src/todos.test.ts extensions/pi-todos/src/index.test.ts`
  - Seam: `extensions/pi-todos` keyboard chord listener, slash command, and widget renderer.
  - Behavior: typing `Ctrl+X` followed by `p` (`^x p`) or running `/panel toggle` toggles sticky widget visibility between full display and 0-line collapsed state; background tasks and subagents share consistent row schema `#<id> <elapsed> (<target>) <status>`.
  - Failures: chord state lockup, stuck key handling, collapsed widget returning whitespace lines, or inconsistent row formatting.

- [x] S123 [R51] [D123]: `pi-todos` supports editing todo text, priority levels, bulk completion, and search/filter
  - Verify: `npx vitest run extensions/pi-todos/src/todos.test.ts extensions/pi-todos/src/index.test.ts`
  - Seam: `extensions/pi-todos` block parser and slash-command handlers.
  - Behavior: `/todo edit <id> <text>` renames a todo; priority (high/medium/low) displays and sorts; `/todo complete all` marks all done; `/todos search <query>` filters by text.
  - Failures: edit not persisting, priority not sorting, bulk complete skipping items, search returning wrong results.

#### System Shape

- [x] S124 [R52] [D124]: `pi-tasks` streams live output and supports task dependencies
  - Verify: `npx vitest run extensions/pi-tasks/src/index.test.ts extensions/pi-tasks/src/registry.test.ts`
  - Seam: `extensions/pi-tasks` registry and runner.
  - Behavior: `/task logs <id>` tails running task output; task B declares dependency on task A and waits for A to complete before starting; circular dependencies rejected.
  - Failures: logs not updating, dependency deadlock, circular dep not detected.

#### Framework & Library Choices

- [x] S125 [R53] [D125]: `pi-modal` adds vim-style search, substitution, syntax highlighting, and visual selection background
  - Verify: `npx vitest run extensions/pi-modal/src/index.test.ts`
  - Seam: `extensions/pi-modal` editor component.
  - Behavior: `/` searches buffer with n/N navigation; `:%s/old/new/g` replaces across lines; code blocks get language-aware highlighting; visual selection renders with distinct background.
  - Failures: search not finding matches, substitution corrupting text, highlighting not applying, selection invisible.

#### Data & Contracts

- [x] S126 [R54] [D126]: `pi-usage` merges with `pi-budgets`, tracks per-model cost, cache tokens, and subagent usage
  - Verify: UNVERIFIED: `npx vitest run extensions/pi-usage/src/index.test.ts extensions/pi-budgets/src/budget.test.ts`
  - Seam: `extensions/pi-usage` and `extensions/pi-budgets` (merged).
  - Behavior: `/usage` shows per-model token and cost table; cache read/write tokens tracked; subagent turns included in totals; budget caps enforced with soft warnings at 80%.
  - Failures: incorrect cost calculation, missing cache tokens, subagent usage not attributed, budget not enforcing.

#### System Shape

- [x] S127 [R55] [D127]: `pi-subagents` supports pause/resume and steering messages
  - Verify: `npx vitest run extensions/pi-subagents/src/index.test.ts extensions/pi-subagents/src/runner.test.ts`
  - Seam: `extensions/pi-subagents` runner and state.
  - Behavior: `/subagent pause <id>` suspends running subagent; `/subagent resume <id>` continues; parent can send steering message to redirect next turn.
  - Failures: pause not suspending, resume losing context, steering not delivered.

#### Data & Contracts

- [x] S128 [R56] [D128]: `pi-web` adds response caching, rate limiting, and content-type negotiation
  - Verify: `npx vitest run extensions/pi-web/src/fetch.test.ts extensions/pi-web/src/tools.test.ts`
  - Seam: `extensions/pi-web` fetch and tools.
  - Behavior: Repeated fetches within TTL return cached response; requests exceeding rate limit are queued; Accept header negotiates JSON/HTML/text.
  - Failures: cache not hit, rate limit not enforced, wrong content type returned.

#### Operations & Security

- [x] S129 [R57] [D129]: `pi-dashboard` adds error recovery, interactive refresh, and custom renderers
  - Verify: `npx vitest run extensions/pi-dashboard/src/index.test.ts extensions/pi-dashboard/src/render.test.ts`
  - Seam: `extensions/pi-dashboard` controller and render.
  - Behavior: Failed sections retry with backoff; key press refreshes section; custom TS render functions and inline images supported.
  - Failures: no retry on failure, refresh not triggering, custom renderer not loading.

#### Module Seams

- [x] S130 [R58] [D130]: `pi-language-tools` adds hover tool returning type/signature/docs with optional TUI popup
  - Verify: `npx vitest run extensions/pi-language-tools/src/tool.test.ts extensions/pi-language-tools/src/index.test.ts`
  - Seam: `extensions/pi-language-tools` tool and LSP client.
  - Behavior: hover tool returns structured type/signature/docs to model; TUI popup shows same info when UI available; popup dismissible.
  - Failures: hover returning empty, popup not showing, popup not dismissible.

#### Framework & Library Choices

- [x] S131 [R59] [D131]: `pi-statusline` adds configurable click actions; custom TS component loading is deferred
  - Verify: `npx vitest run extensions/pi-statusline/src/index.test.ts extensions/pi-statusline/src/components.test.ts`
  - Seam: `extensions/pi-statusline` components and config.
  - Behavior: `/statusline click <segment>` runs a configured slash action or external command; custom ComponentFn loading is tracked in `artifacts/plan.md` backlog.
  - Failures: click action not triggering, action output/error not reported, custom loader shipped without a contract.

#### Data & Contracts

- [x] S132 [R60] [D132]: `pi-agent` validates agent configs with schema and reports errors
  - Verify: `npx vitest run extensions/pi-agent/src/agents.test.ts extensions/pi-agent/src/index.test.ts`
  - Seam: `extensions/pi-agent` agents module.
  - Behavior: Missing fields, invalid models, unknown modes produce clear errors; invalid agents skipped with warning.
  - Failures: invalid config silently accepted, no warning shown.

- [x] S133 [R61] [D133]: `pi-hooks` adds hook chaining, conditional execution, output formatting, and per-hook timeout
  - Verify: `npx vitest run extensions/pi-hooks/src/hooks.test.ts extensions/pi-hooks/src/index.test.ts`
  - Seam: `extensions/pi-hooks` hooks module.
  - Behavior: Hooks chain with output piped; conditions filter by tool/path; output format configurable; timeout per hook.
  - Failures: chain not executing in order, conditions not filtering, timeout not enforced.

- [x] S134 [R62] [D134]: `pi-question` supports multi-page questions with Next/Back and conditional branching
  - Verify: `npx vitest run extensions/pi-question/src/questions.test.ts extensions/pi-question/src/index.test.ts`
  - Seam: `extensions/pi-question` questions module.
  - Behavior: Multi-page with Next/Back navigation; answer to Q1 conditionally shows/hides Q2; state stays in context window only.
  - Failures: navigation not working, conditions not evaluating, state persisted unexpectedly.

#### Operations & Security

- [x] S135 [R63] [D135]: `pi-guard` supports temporary permission grants with expiry
  - Verify: `npx vitest run extensions/pi-guard/src/index.test.ts extensions/pi-guard/src/rules.test.ts`
  - Seam: `extensions/pi-guard` rules and index.
  - Behavior: `/grant <path-or-tool> <duration>` temporarily allows; grant expires after duration or session end; `/grants` lists active.
  - Failures: grant not applying, expiry not enforced, grants not listed.

#### Framework & Library Choices

- [x] S136 [R64] [D136]: Animated working indicator with spinner and elapsed timer
  - Verify: `npx vitest run extensions/pi-tasks/src/index.test.ts extensions/pi-statusline/src/index.test.ts`
  - Seam: `extensions/pi-tasks` and `extensions/pi-statusline` UI.
  - Behavior: Spinner animation with elapsed timer during agent streaming; background tasks show animated progress; respects reduced-motion and config toggle.
  - Failures: no animation, timer not updating, reduced-motion not respected.

- [x] S137 [R65] [D137]: `pi-modal` supports configurable border styles
  - Verify: `npx vitest run extensions/pi-modal/src/index.test.ts`
  - Seam: `extensions/pi-modal` editor component.
  - Behavior: `modal.json` accepts `borderStyle` (rounded/double/dashed/sharp/none); default rounded; borders on right side only.
  - Failures: border style not applied, wrong side bordered, default not rounded.

### Core cache and usage attribution

#### Module Seams

- [x] S138 [R08] [R26] [D138]: core exposes a session-scoped TTL/LRU cache, and `pi-decide` uses it for per-session results and in-flight dedupe
  - Verify: `npx vitest run packages/core/src/session-cache.test.ts extensions/pi-decide/src/decide.test.ts`
  - Seam: `@hollowheap/core` session cache plus classifier request state.
  - Behavior: caches are namespaced by session owner; LRU eviction at 128 entries; TTL applies to results; `dropSession` clears the owner's caches; in-flight entries are deleted when settled.
  - Failures: cross-session reuse, unbounded growth, stale entries after TTL, cache surviving session teardown, duplicate concurrent requests.

#### System Shape

- [x] S141 [R66] [D141]: `pi-tasks` exports reusable `TaskStore` and `spawnDetachedTask`; `pi-subagents` consumes them
  - Verify: `npx vitest run extensions/pi-tasks/src extensions/pi-subagents/src`
  - Seam: task store, state locking, detached spawn, package dependency graph.
  - Behavior: host subagent state uses `TaskStore<SubagentState>` under `subagents/`; subagent runners use `spawnDetachedTask`; shell tasks use the same primitives under `tasks/`; the detached JS shim keeps its minimal atomic write.
  - Failures: divergent host-side lock behavior, lost state updates, missing dependency, or duplicated spawn code.

- [x] S142 [R67] [D142]: `pi-subagents` supports generic CLI harnesses selected by agent frontmatter
  - Verify: `npx vitest run extensions/pi-subagents/src/config.test.ts extensions/pi-subagents/src/tool.test.ts extensions/pi-subagents/src/runner.test.ts`
  - Seam: `subagents.json` `harnesses`, agent frontmatter `harness`, child-spec resolution, runner text input.
  - Behavior: Pi uses JSONL RPC and session continuation; generic harnesses use `stdin` or `arg` prompt delivery, raw-text steering, and shared task wait/cancel/resume.
  - Failures: unknown harness, invalid harness config, duplicated prompts, JSON wrapper leaking to a plain CLI, or broken Pi fallback.

#### Operations & Security

- [x] S143 [R18] [D143]: Todo processing and the prompt section work in every mode, state survives compaction, and terminal listeners do not stack
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts`
  - Seam: `message_end`, `before_agent_start`, `session_compact`, session lifecycle, terminal input, event payload validation.
  - Behavior: headless messages persist state and send confirmations; malformed payloads are ignored; compaction re-appends current state; the previous terminal disposer runs before replacement and on shutdown.
  - Failures: headless inertness, duplicate chord handlers, lost state after compaction, or crashes on malformed events.

#### Module Seams

- [x] S144 [R36] [R50] [D144]: Todo widget uses a single options signature, shows open work first, combines todo sections, and uses a proper split junction
  - Verify: `npx vitest run extensions/pi-todos/src/todos.test.ts`
  - Seam: `formatTodoWidget`.
  - Behavior: `formatTodoWidget(todos, subagents, tasks, options)`; up to ten rows with open todos before completed; priority ordering within each group; `┼` at split divider rows; collapsed mode returns undefined; `statusText` removed.
  - Failures: completed rows hiding open work, overloaded argument detection, wrong junction glyph, or dead public exports.

- [x] S145 [R10] [R16] [D145]: `pi-tools` contains searches before execution, filters before stat, uses active-cwd completion, and diagnoses unreadable config
  - Verify: `npx vitest run extensions/pi-tools/src`
  - Seam: `fd`, `rg`, `/cd` completion, config loading.
  - Behavior: outside/denied search targets return no results before binary or stat; result paths are checked before stat; completions resolve against effective cwd and omit denied/outside directories; non-`ENOENT` config errors emit diagnostics.
  - Failures: leaked mtime/existence, symlink escape, completion from process cwd, or silent config fallback.

#### Data & Contracts

- [x] S146 [R16] [D42] [D146]: rg uses JSON output with an internal parser; `isFileTarget` surfaces non-missing stat failures
  - Verify: UNVERIFIED: `npx vitest run extensions/pi-tools/src/rg.test.ts`
  - Seam: rg execution, match parsing, file-target detection.
  - Behavior: `rg --json` match events yield path/line/text; colon-digit text survives; missing targets return false while other stat errors throw; `parseRgLine`/`RgMatch` are not exported.
  - Failures: colon ambiguity, swallowed permission errors, or stale public parser surface.

#### Module Seams

- [x] S147 [R16] [D147]: `fd`/`rg` constructors take exposure only; exec is imported directly and tests mock the exec module
  - Verify: `npx vitest run extensions/pi-tools/src`
  - Seam: `createFdTool`, `createRgTool`, `./exec.js` mocking.
  - Behavior: no `ExecDeps`/`defaultExecDeps`; tool signatures are `(exposure?)`; fake-output tests control `runBinary`/`statMtimeMs` via mocks; real-binary integration tests restore actual implementations.
  - Failures: stale dependency injection, broken exposure argument order, or tests bypassing the actual exec path unintentionally.

- [x] S148 [R16] [R21] [D148]: Remove direct `fd`/`rg`; `pi-tools` exposes only `/cd`
  - Verify: `npx vitest run extensions/pi-tools/src`
  - Seam: `pi-tools` extension registration and `/cd` command.
  - Behavior: no model tools or `pi-tools.json`; `/cd` keeps effective-cwd and policy behavior; search uses `bash`; no tool schema cost.
  - Failures: stale tool registration, duplicate search surfaces, or broken `/cd` completion/guard rewriting.

#### Data & Contracts

- [x] S149 [R39] [R54] [D149]: `pi-usage` validates restored data, includes cache tokens, prices by message model, tracks sessions in a WeakMap, and supports `/usage cap`
  - Verify: `npx vitest run extensions/pi-usage/src/index.test.ts`
  - Seam: usage extraction, recording, formatting, session lifecycle, and `/usage` command.
  - Behavior: invalid by-model entries are skipped; totals include cache read/write; per-turn cost uses the assistant message model; no per-update cost rounding drift; cap warns at 80% and aborts at 100%; cap changes persist and restore.
  - Failures: stale model pricing, cache undercount, lost session state, duplicate budget setters, or malformed entries poisoning totals.

#### Module Seams

- [x] S150 [R10] [R14] [R45] [R54] [D150]: Retire `pi-budgets`; autopilot has no mandatory cap, and `pi-usage` owns optional caps and the statusline provider
  - Verify: `npx vitest run extensions/pi-usage/src/index.test.ts extensions/pi-autopilot/src/index.test.ts extensions/pi-statusline/src`
  - Seam: pi-usage cap/statusline events, pi-autopilot mode registration, pi-statusline `usage` provider.
  - Behavior: autopilot enters without a cap; `/usage cap` sets or clears a dollar cap; 80% warns and 100% aborts; statusline displays `$used/$cap` under `usage`; pi-budgets is absent.
  - Failures: mandatory cap gate returns, stale `/budget` or `budgets` provider remains, duplicate cap accounting, or statusline loses the cap ratio.

#### Data & Contracts

- [x] S151 [R39] [R54] [D151]: Budget caps are USD-only after the pi-budgets merge; token caps are dropped
  - Verify: `npx vitest run extensions/pi-usage/src/index.test.ts`
  - Seam: `/usage cap`, `CumulativeUsage.budgetCap`, statusline `usage` provider.
  - Behavior: cap parsing accepts dollar amounts; no token-cap command/state remains; warning is 80%, abort is 100%; autopilot has no mandatory cap.
  - Failures: token-cap remnants, duplicate cap systems, or cap state that does not survive compaction.

#### System Shape

- [x] S152 [R54] [R68] [D152]: `pi-usage` attributes current-parent subagent usage from child session files
  - Verify: `npx vitest run extensions/pi-usage/src/index.test.ts extensions/pi-subagents/src/index.test.ts`
  - Seam: `pi-usage` child-session scanner/report/cap and `pi-subagents` state `parentSession`/`session` fields.
  - Behavior: `/usage` lists each Pi subagent for the current parent with agent, model, tokens, and USD cost; the same spend rolls into per-model and session totals and the USD cap; generic CLI subagents show usage unavailable and are excluded; scans refresh when a child leaves the active set and before the parent's next run; running children are skipped; other parent sessions are excluded; resume replaces rather than adds the child snapshot.
  - Failures: cross-session leakage, double-counted resumed sessions, stale snapshots after child exit, cap ignoring subagent spend, or a generic harness reported as zero-cost.

### External alerts

#### Operations & Security

- [x] S156 [R69] [D157] [D162]: External alerts fire for completion, error, question, task completion, and subagent completion; permission/ask events stay in-terminal.
  - Verify: `npx vitest run packages/core/src/alerts.test.ts`
  - Seam: core alert event contract and per-extension adapters.
  - Behavior: the five event categories emit alerts; permission/ask remains in-terminal; duplicate completion alerts are suppressed.
  - Failures: missing event, permission alert leakage, duplicate delivery, or blocking the agent.

- [x] S157 [R69] [D158] [D162]: Linux native delivery is used when available, with terminal bell/OSC fallback when the notifier is missing.
  - Verify: `npx vitest run packages/core/src/alerts.test.ts`
  - Seam: core delivery helper and platform adapter.
  - Behavior: Linux native notifier is selected; missing notifier falls back to terminal; macOS/Windows native adapters are not claimed.
  - Failures: failing the turn when notifier is missing, silently dropping the alert, or claiming unsupported native delivery.

- [x] S158 [R70] [D159] [D162]: Alert payloads carry only event and status identifiers, never prompt, task, or tool content.
  - Verify: `npx vitest run packages/core/src/alerts.test.ts`
  - Seam: core alert payload builder.
  - Behavior: payloads contain event type, IDs, and status; prompt/task/tool text is excluded; no secrets are logged.
  - Failures: prompt leakage, task text, tool output, or secret-bearing error messages.

- [x] S161 [R74] [D165]: Task completion emits one external completion alert through the core helper; alert failure does not change task status.
  - Verify: `npx vitest run extensions/pi-tasks/src/alerts.test.ts`
  - Seam: task/runtime completion transition and core alert dispatcher.
  - Behavior: completed and failed tasks emit one alert; duplicate terminal transitions are suppressed; delivery failure is ignored.
  - Failures: duplicate alerts, alert failure failing the task, or prompt/task text in the payload.

- [x] S162 [R74] [D165]: Subagent completion emits one external completion alert through the core helper; alert failure does not change subagent state.
  - Verify: `npx vitest run extensions/pi-subagents/src/alerts.test.ts`
  - Seam: subagent state transitions and core alert dispatcher.
  - Behavior: completed and failed subagents emit one alert; duplicate state ticks are suppressed; delivery failure is ignored.
  - Failures: duplicate alerts, alert failure changing state, or prompt/task text in the payload.

- [x] S165 [R75] [D166]: A handled question block emits one external question alert with no prompt or option text.
  - Verify: `npx vitest run extensions/pi-question/src/alerts.test.ts`
  - Seam: question message handling and core alert helper.
  - Behavior: one alert per valid question batch; payload contains only event/status; delivery failure is ignored.
  - Failures: duplicate alerts, prompt/option leakage, or alert failure blocking the dialog.

- [x] S166 [R75] [D166]: Agent completion emits one external completion alert with no prompt or task text.
  - Verify: `npx vitest run extensions/pi-statusline/src/alerts.test.ts`
  - Seam: statusline agent lifecycle and core alert helper.
  - Behavior: one alert per agent run; payload contains only event/status; delivery failure is ignored.
  - Failures: duplicate alerts per turn, prompt leakage, or alert failure affecting the footer.

### Isolated workspaces

#### System Shape

- [x] S159 [R71] [D160] [D163]: Isolated workspaces are opt-in for concurrent tasks and subagents; the single-writer lock remains the default.
  - Verify: `npx vitest run packages/core/src/workspace.test.ts`
  - Seam: core workspace allocation and consumer opt-in.
  - Behavior: isolation is explicit; unconfigured work uses the writable lock; concurrent isolated writers do not share the same workspace.
  - Failures: default isolation, shared writable workspace, or lock bypass.

- [x] S160 [R71] [D160] [D163]: Isolated workspace integration and cleanup are explicit; no automatic merge or orphan workspace.
  - Verify: `npx vitest run packages/core/src/workspace.test.ts extensions/pi-tasks/src/workspace.test.ts extensions/pi-subagents/src/workspace.test.ts`
  - Seam: core workspace lifecycle consumed by task and subagent owners.
  - Behavior: integration requires an explicit action; success, error, and shutdown cleanup remove the workspace; no automatic merge or remote workspace.
  - Failures: automatic merge, orphan workspace, cleanup only on success, or remote/SSH isolation.

- [x] S163 [R73] [D164]: Task start accepts `isolated: true`, uses a dedicated core workspace, and cleans it on completion, failure, or cancel.
  - Verify: `npx vitest run extensions/pi-tasks/src/task-tool.test.ts extensions/pi-tasks/src/workspace.test.ts`
  - Seam: `task` start schema, task metadata, and workspace cleanup.
  - Behavior: isolated true allocates a separate cwd; omitted/false uses the shared cwd; terminal/cancel removes the workspace.
  - Failures: shared cwd despite isolation, orphan workspace, or cleanup on success only.

- [x] S164 [R73] [D164]: Subagent start accepts `isolated: true`, uses a dedicated core workspace, and cleans it on completion, failure, or cancel.
  - Verify: `npx vitest run extensions/pi-subagents/src/tool.test.ts extensions/pi-subagents/src/workspace.test.ts`
  - Seam: `subagent` start schema, subagent state, and workspace cleanup.
  - Behavior: isolated true allocates a separate cwd; omitted/false uses the shared cwd; terminal/cancel removes the workspace.
  - Failures: shared cwd despite isolation, orphan workspace, or cleanup on success only.

### Imported subagent runs

#### Module Seams

- [x] S167 [R76] [D167]: Active upstream async runs map to the local `subagents:state` item shape without a dependency or runtime bridge.
  - Verify: `npx vitest run extensions/pi-subagents/src/upstream.test.ts`
  - Seam: pure mapper from upstream `asyncSnapshot.runs` to local state items.
  - Behavior: map run id to id, agent/label to agent, state to local active state, startedAt, and activity tool fields; omit terminal runs; task text is empty or label-derived.
  - Failures: terminal rows imported, missing active tool, wrong state mapping, or dependency on upstream package.

### Media content

#### Module Seams

- [x] S168 [R77] [D168]: Direct PDF fetches extract bounded text locally and fail explainably.
  - Verify: `npx vitest run extensions/pi-web/src/pdf.test.ts extensions/pi-web/src/fetch.test.ts`
  - Seam: raw fetch content-type branch and local PDF extractor.
  - Behavior: `application/pdf` bytes are parsed to capped text; malformed/oversized input returns explanatory text; no upstream call.
  - Failures: empty PDF content, unbounded output, crash on parser failure, or browser/upstream fallback.

- [x] S169 [R78] [D169]: Direct image fetches return one bounded image block with MIME type.
  - Verify: `npx vitest run extensions/pi-web/src/image.test.ts extensions/pi-web/src/tools.test.ts`
  - Seam: raw fetch image branch and tool result content.
  - Behavior: supported PNG/JPEG/GIF/WebP bytes under the cap become an image block; unsupported/oversized images return text; metadata/previews remain.
  - Failures: image bytes as text, oversized payload, wrong MIME, or upstream dependency.

### Session subagent definitions

#### Module Seams

- [x] S170 [R79] [D173]: The `subagent` tool's `define` action stores session-only agents as `hollowheap.subagent.definition` entries and start resolves them before file agents.
  - Verify: `npx vitest run extensions/pi-subagents/src`
  - Seam: `definitions.ts` branch parser, `tool.ts` define/start resolution, and `index.ts` session restore/persistence.
  - Behavior: `define` validates name and system prompt; optional tools/model/thinking/mode/effort/harness are trimmed; entries restore on session start and tree navigation; session definitions shadow file agents; define passes guard/policy without a shell prompt while start keeps the existing gate; shutdown clears the map.
  - Failures: writing files, accepting invalid definitions, stale definitions after branch switch, file agents winning the name collision, or losing the definition on resume.

- [x] S171 [R80] [D174]: `delete` appends a session tombstone for session-defined names only, and `maxSessionAgents`/`maxSessionAgentBytes` bound new definitions.
  - Verify: `npx vitest run extensions/pi-subagents/src extensions/pi-guard/src packages/policy/src`
  - Seam: `definitions.ts` definition/tombstone parser, `tool.ts` delete and bound checks, `index.ts` delete persistence, and `config.ts` session bounds.
  - Behavior: delete removes a session definition and fails for file-only names; tombstones are order-sensitive with later definitions; redefinition does not consume a new slot; serialized definitions over the byte limit or new names over the count limit are rejected; invalid config values diagnose and fall back; delete passes guard/policy.
  - Failures: deleting file agents, resurrecting deleted definitions on restore, rejecting redefinitions at the count limit, bypassing bounds through define, or accepting invalid config silently.

### Observational memory

#### Module Seams

- [x] S172 [R81] [D175]: A new `pi-memory` extension owns an opt-in observer, branch-local memory entries, compaction injection, commands, and usage refresh.
  - Verify: `npx vitest run extensions/pi-memory/src extensions/pi-usage/src`
  - Seam: `config.ts` for `memory.json`, `ledger.ts` for observations/consumed/clear entries, `observer.ts` for the model call and JSON parse, and `index.ts` for lifecycle, compaction, commands, and usage.
  - Behavior: disabled by default; explicit `provider/model`; pending messages trigger observer after `observeAfterTokens`; observations and empty-result consumed markers append to the session; clear and branch restore are order-sensitive; compaction passes memory as extra focus to the host summarizer; observer usage appends to `hollowheap.usage` and emits `usage:refresh`; redaction defaults on; `/memory status|view|clear` work; ACP registers nothing.
  - Failures: hidden model calls while disabled, repeated calls on consumed messages, stale results after branch navigation, losing usage spend, injecting secrets by default, replacing compaction with a memory-only summary, or writing a separate memory file.
