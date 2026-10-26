# Plan

ACP tasks A1-A14 were renumbered to T71-T84; they are older than T01-T20, so they appear first.

## Completed (oldest first)

- [x] T71 [S28] (blocked-by: none): recon (rpc shapes, socket lifecycle, SDK/spec surface) + this plan. | Verify: rg -q "^## " artifacts/plan.md
  - Files: see A1 in git history
  - Notes: Archived ACP task A1, renumbered to T71; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T72 [S16] (blocked-by: none): scaffold `packages/pi-acp`, reshape to adapter layout (no external deps), `npm install`. | Verify: npm run typecheck
  - Files: see A2 in git history
  - Notes: Archived ACP task A2, renumbered to T72; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T73 [S16] [S18] (blocked-by: none): ACP server skeleton (initialize/new/list/load/cancel/set_config + JSON store + socket transport + pi spawn/request) with tests. | Verify: npm test
  - Files: see A3 in git history
  - Notes: Archived ACP task A3, renumbered to T73; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T74 [S19] (blocked-by: none): permission/fs/terminal client-request paths (10s timeout) with tests. | Verify: npm test
  - Files: see A4 in git history
  - Notes: Archived ACP task A4, renumbered to T74; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T75 [S16] (blocked-by: none): bundled extension (tools, modes, gates, socket client, markers/existence/compare checks) with tests. | Verify: npm test
  - Files: see A5 in git history
  - Notes: Archived ACP task A5, renumbered to T75; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T76 [S18] (blocked-by: none): prompt-turn bridge (event mapping, settle response, cancel→abort) with tests. | Verify: npm test
  - Files: see A6 in git history
  - Notes: Archived ACP task A6, renumbered to T76; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T77 [S18] (blocked-by: none): session/load replay via `get_messages` fixtures with tests. | Verify: npm test
  - Files: see A7 in git history
  - Notes: Archived ACP task A7, renumbered to T77; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T78 [S17] (blocked-by: none): spawn wiring + bin + README; live smoke (initialize/new/list, zero load errors, no model call). | Verify: test -f artifacts/logs/acp-live.log
  - Files: see A8 in git history
  - Notes: Archived ACP task A8, renumbered to T78; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T79 [S16] [S17] [S18] [S19] [S20] (blocked-by: none): final `npm run typecheck`, `npm test`, `npm run lint`. | Verify: npm run typecheck && npm test && npm run lint
  - Files: see A9 in git history
  - Notes: Archived ACP task A9, renumbered to T79; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T80 [S14] (blocked-by: none): three-way `checkBash` in `pi-guard/src/bash.ts` + tests; `pi-guard` shell path asks on no-allow-rule; README matrix updated. | Verify: npm test
  - Files: see A10 in git history
  - Notes: Archived ACP task A10, renumbered to T80; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T81 [S14] [S19] (blocked-by: none): pi-acp vendored `bash.ts` three-way + hook/`acp_bash` ask client, local-rules fallback (`ToolDeps.connected`); tests. | Verify: npm test
  - Files: see A11 in git history
  - Notes: Archived ACP task A11, renumbered to T81; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T82 [S28] (blocked-by: none): rename pi-acp modes to `plan/ask/edit` and plan paths to `artifacts/plan.md` + `artifacts/specs.md` (extension, adapter, main appendix, README); tests. | Verify: npm test && npm run typecheck
  - Files: see A12 in git history
  - Notes: Archived ACP task A12, renumbered to T82; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T83 [S19] (blocked-by: none): guard `session/list` missing params; fix `plan.md:29` `-xt` drift. | Verify: npm test
  - Files: see A13 in git history
  - Notes: Archived ACP task A13, renumbered to T83; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T84 [S16] [S17] [S18] [S19] [S20] (blocked-by: none): `npm run typecheck`, `npm test`, `npm run lint`; rebuild `packages/pi-acp/dist`. | Verify: npm test
  - Files: see A14 in git history
  - Notes: Archived ACP task A14, renumbered to T84; implementation and tests are in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T01 [S01] [S06] [S08]: core `policy.ts`: widen effects to allow/ask/deny, move glob/specificity/realpath/workspace-boundary matching from `extensions/pi-guard/src/rules.ts:14-99`, omit array order; bump every workspace package to `0.2.0`. | Verify: `npm test` (core table tests: specificity, ties stricter, outside-root deny).
  - Files: extensions/pi-guard/src/rules.ts:14-99
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T02 [S01]: core `config.ts`: mtime-cached permission loader for `<agentDir>/permissions.json` plus a `.pi/permissions.json` overlay only when `trusted`, with once-per-change diagnostics (port `extensions/pi-guard/src/loader.ts:79-121`) and widened rule parsing. | Verify: `npm test` (cache hit, mtime change, malformed file, untrusted overlay skipped).
  - Files: extensions/pi-guard/src/loader.ts:79-121
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T03 [S08] [S14]: core `shell.ts`: token-boundary prefix matching, split on `\n` and `&` as well as `&&`/`||`/`;`/`|`, strictest-part result, extend hard denies to interpreters and process substitution (port `extensions/pi-guard/src/bash.ts:27-87`). | Verify: `npm test` (cases for `git` vs `github`, newline/background chains, `<(`, `bash -c`).
  - Files: extensions/pi-guard/src/bash.ts:27-87
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T04 [S05]: core `exec.ts`/`format.ts`: bounded `runBinary` (maxBuffer, abort, okExitCodes, ENOENT/cwd errors), `truncateText`, `displayTarget`, `displayPath`; fold the three current implementations. | Verify: `npm test`.
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T05 [S02] [S03] [S07] [S09] [S10] [S11]: core `state.ts`/`modes.ts`: globalThis-backed `Symbol.for("@hollowheap/core/state")` registry (survives duplicate module instances), session store for mode/cwd, layer registry (first-wins, diagnostics), entry gates, and `evaluate()` implementing the five-step ladder; mode persistence via `appendCustomEntry("hollowheap.core.mode", { mode })` and `getEntries()` restore, re-running gates on restore (veto → `ask`). | Verify: `npm test` (two module instances share state; ladder cases for plan/edit/ask/autopilot; resume/fork restore; removed mode → ask).
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T06 [S12]: pi-guard: use core `evaluate`/`loadPermissions`/`truncateText`; delete `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts` and their tests; keep prompting, `/mode`, `alt+m`, statusline value. | Verify: `npm test` + `npm run typecheck`.
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T07 [S13]: pi-budgets: register the autopilot entry gate on core; drop the `guard:mode-enter` listener/envelope. | Verify: `npm test` (veto without cap, allow with cap).
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T08 [S13]: pi-autopilot: register the `autopilot` layer with allow defaults; drop the `guard:modes` listener. | Verify: `npm test`.
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T09 [S14]: pi-tools: `/cd` and `effectiveCwd` via core (works standalone); `fd`/`rg` keep `ask` paths (filter only `deny`) and pass `--glob … --` / `--regexp … --`; delete `rules.ts`, `loader.ts`. | Verify: `npm test` (standalone /cd, dash-leading pattern, ask-path result retained).
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T10 [S21] [S22]: pi-statusline + pi-dashboard cwd segments read core `effectiveCwd`. | Verify: `npm test`.
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T11 [S16]: pi-acp extension: replace vendored policy/`decide()` with core `evaluate`; delete `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts`, `exec.ts` and the local policy tests; hook asks over the socket on `ask`, denies when disconnected. | Verify: `npm test` + `rg -n "checkBash|loadRules|decide|isPlanPath" packages/pi-acp/src` empty.
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T12 [S17]: pi-acp spawn: add `-nbt` so built-ins cannot bypass ACP tools; assert args. | Verify: `npm test`.
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T13 [S18]: pi-acp lifecycle: close existing live session before reload and on startup-validation failure; register prompt completion before `prompt` (`adapter.ts:795-801`); reject pending prompts/permissions/clients on exit and close; push mode on connect/reconnect and buffer pre-handshake sets. | Verify: `npm test` (reload leak, prompt race, early set_config).
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T14 [S19] [S20]: pi-acp protocol/tools: forward the real tool-call id to `session/request_permission` (`adapter.ts:576-581`); bound terminal polling with a wall-clock timeout (`extension/tools.ts:217-241`); delete timed-out client entries (`client-requests.ts:40-56`); `acp_write` parent mkdir, `acp_edit` missing-file error, `acp_fd`/`acp_rg` separators, `acp_eza` `isDirectory()`; remove unused helpers. | Verify: `npm test` + `npm run typecheck`.
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T15 [S21]: pi-statusline: render extension segments through `styleComponent` (not `styleText`) and truncate left text first so right-pinned sections stay visible (`render.ts:40-61`). | Verify: `npm test` (pill styling, narrow width keeps right).
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T16 [S22]: pi-dashboard: AbortController per section, abort in-flight commands on `stop()` and `session_shutdown`; confirm dynamic width reaches `fitLines` (`index.ts:64-98,146-158`). | Verify: `npm test` (abort called, no post-shutdown render).
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T17 [S04] [S23]: docs/policy: `AGENTS.md:4` (core runtime dependency exception, drop "types-only"), core/pi-* READMEs (delete vendoring claims, document `dependencies`, `0.2.0`, and the `<agentDir>/permissions.json` + trusted overlay locations), pi-acp README spawn/mode/permission text, and `modes.json` schema plus mode-persistence behavior in core/guard READMEs. | Verify: `npm run lint` + read-back.
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T18 [S23] [S28]: full verification: `npm run typecheck`, `npm test`, `npm run lint`, `npx tsc -p packages/pi-acp`; live ACP smoke (client mode switch, one permission prompt with the real tool id, no built-in tool execution, mode restored after resume). | Verify: commands green + smoke log.
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T19 [S25] [S26]: core `config.ts` + wiring: `loadModesConfig(agentDir)` for `<agentDir>/modes.json` (schema, restrictive-override validation, name collisions, once-per-change diagnostics) and `replaceConfigModes` at session start in pi-guard and the pi-acp extension. | Verify: `npm test` (valid layer, `allow` override rejected, collision diagnosed, reload replaces config layers).
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T20 [S28]: the extension answers `get-modes` over the socket with the core registry's layers (`name`, optional `description`); the adapter fetches them at session start, validates `set_config` against them, and builds the mode config option from them, falling back to its built-in list. A mode notice rides in the returned option's description. | Verify: `npm test` (adapter offers the extension's modes, accepts `autopilot`, notice lands in the option description; extension answers `get-modes`).
  - Files: see task text
  - Notes: Archived task; implementation and tests are recorded in git history.
  - Risk: Historical regression coverage is in the Verify command.

- [x] T21 [S29] (blocked-by: none): core `runCapture(command, args, cwd, signal, opts?)` in `packages/core/src/exec.ts` takes optional stdin and resolves `{ code, stdout, stderr }` instead of throwing on a non-zero exit, keeping the abort, maxBuffer, and timeout behavior; the hook protocol needs the exit code and stderr as values, and a second subprocess implementation in a consumer is the duplication D05 forbids.
  - Verify: `npx vitest run packages/core/src/exec.test.ts`
  - Files: packages/core/src/exec.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T22 [S30] (blocked-by: T21): `extensions/pi-hooks/src/config.ts` parses `<agentDir>/hooks.json` and, only when `ctx.isProjectTrusted()`, `<project>/.pi/hooks.json`; the loader is mtime-cached per instance (one reader, so no shared globalThis cache), and a malformed file, unknown key, missing `command`, or bad `matcher` is a diagnostic that drops only the offending hook.
  - Verify: `npx vitest run extensions/pi-hooks/src/config.test.ts`
  - Files: extensions/pi-hooks/src/config.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T23 [S29] (blocked-by: T21, T22): `extensions/pi-hooks/src/hooks.ts` matches hooks by tool name (exact, or a trailing `*` prefix), runs the command with the tool call JSON on stdin in the effective cwd, and resolves the verdict: stdout JSON `{"decision":"block","reason":...}` blocks, `{"decision":"allow"}` and empty stdout with exit 0 pass, exit 2 blocks with stderr as the reason, and any other failure blocks with the failure as the reason (D40).
  - Verify: `npx vitest run extensions/pi-hooks/src/hooks.test.ts`
  - Files: extensions/pi-hooks/src/hooks.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T24 [S31, S32, S34] (blocked-by: T23): `extensions/pi-hooks/src/index.ts` runs the matching pre-hooks on `tool_call` and stops at the first block, runs the matching post-hooks on `tool_result` and appends their output truncated by core's `truncateText`, never mutates `event.input` and never replaces result content; the package is registered in the root `package.json` `pi.extensions` list after `pi-guard` so the core policy decides first.
  - Verify: `npx vitest run extensions/pi-hooks/src/index.test.ts`
  - Files: extensions/pi-hooks/src/index.ts, package.json
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T25 [S33, S35] (blocked-by: T24): `extensions/pi-hooks/src/skills/hooks-init/SKILL.md` is contributed through `pi.on("resources_discover", ...)`, is not under the package's conventional `skills/` root so it is never discovered twice, and teaches the file locations, the schema, the verdict protocol, and the trust consequence of writing `hooks.json`; pi-hooks registers no model-callable tool.
  - Verify: `npx vitest run extensions/pi-hooks/src/index.test.ts`
  - Files: extensions/pi-hooks/src/skills/hooks-init/SKILL.md
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T26 [S29, S30] (blocked-by: T25): the pi-hooks README documents the config schema, the stdin payload, the verdict protocol, the trust model, and the skill; the core README documents `runCapture`; `npm test`, `npm run typecheck`, and `npm run lint` are green.
  - Verify: `npm test`
  - Files: see task text
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T27 [S87] (blocked-by: none): `extensions/pi-tools/src/fd.ts` and `rg.ts` register with `exposure: "codemode"`, so they are not declared by default; the no-schema-mutation invariant depends on keeping `tool_search` disabled because it also searches `codemode` tools; `extensions/pi-tools/src/index.test.ts` asserts both exposures.
  - Verify: `npx vitest run extensions/pi-tools/src/index.test.ts`
  - Files: extensions/pi-tools/src/fd.ts, extensions/pi-tools/src/index.test.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T28 [S87] (blocked-by: T27): `extensions/pi-tools/src/index.ts` activates the registered `codemode` tool on every `session_start` when it is inactive, skipping only absent and already-active cases; `extensions/pi-tools/README.md` documents the behavior, reload re-activation, and the no-`tool_search` invariant.
  - Verify: `npx vitest run extensions/pi-tools/src/index.test.ts`
  - Files: extensions/pi-tools/src/index.ts, extensions/pi-tools/README.md
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T29 [S37, S38, S39] (blocked-by: none): core `packages/core/src/blocks.ts` exports `scanTaggedBlocks(markdown)` returning `{ tag, body, start, end, closed }` for `'''tag` through `'''` (multiple/unclosed blocks, markdown code fences ignored) and `parseMarkdownBlocks(body)` returning heading/list/listItem/paragraph nodes with ordered and optional checked state (no inline parsing, no throw); export both from `src/index.ts`; the module imports no host/typebox and core gains no dependency; `packages/core/src/blocks.test.ts` covers the edge cases.
  - Verify: `npx vitest run packages/core/src/blocks.test.ts && ! rg -l "@earendil-works|typebox" packages/core/src/blocks.ts && jq -e 'has("dependencies") | not' packages/core/package.json >/dev/null`
  - Files: packages/core/src/blocks.ts, src/index.ts, packages/core/src/blocks.test.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T30 [S40, S51] (blocked-by: T29): `extensions/pi-question/src/questions.ts` parses valid `question` blocks from the core AST into `{ prompt, mode, options }` (H2 per question, ordered lists, all checked => multi marker, none => single, mixed/9+ options/reserved `Write-in answer` => block invalid, zero options => free-text, source order) and formats numbered answers with the 500-character write-in cap and explicit `none selected`/`no answer`; `extensions/pi-question/src/questions.test.ts` covers valid, invalid, multi, single, free-text, and limit cases.
  - Verify: `npx vitest run extensions/pi-question/src/questions.test.ts`
  - Files: extensions/pi-question/src/questions.ts, extensions/pi-question/src/questions.test.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T31 [S36, S41, S48] (blocked-by: T30): `extensions/pi-question/src/index.ts` removes the `question` tool registration; on a live assistant `message_end` it parses text content and asks valid single-select questions sequentially through `ctx.ui.select` plus a final `Write-in answer` row and `ctx.ui.input`; no-UI paths are inert; any cancelled dialog cancels the whole set; resumed messages are not re-asked; `index.test.ts` asserts no `registerTool`, the select/input call shapes, cancellation, and no re-prompt.
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Files: extensions/pi-question/src/index.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T32 [S47] (blocked-by: T31): after all single-select questions are answered, `pi.sendMessage({ customType: "hollowheap.question.answers", content, display: true, details }, { deliverAs: "followUp" })` sends numbered answers only (no question text), with `none selected`/`no answer` as specified; register a renderer for that customType that renders the numbered list and falls back to content when details are missing; `index.test.ts` asserts customType, display, deliverAs, content, and renderer fallback.
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Files: see task text
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T33 [S46] (blocked-by: T30): `registerMarkdownTransformer` removes valid `question` blocks only in assistant messages; unknown tags and fully closed invalid blocks stay visible; an open question fence is removed from its opening line through the current end while streaming; markdown code fences are ignored; the stored message is not changed; `index.test.ts` covers each case.
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Files: see task text
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T34 [S42] (blocked-by: T32): TUI multi-select uses `ctx.ui.custom` with checkbox rows and a final write-in row; space toggles, entering the write-in row opens an inline editor, Enter on Done submits, zero selections is valid, and cancellation cancels the set; answers feed the same follow-up message; `index.test.ts` covers toggling, write-in, zero selection, and cancellation.
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Files: see task text
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T35 [S43] (blocked-by: T32): RPC multi-select uses a `ctx.ui.select` loop with `[ ]`/`[x]` rows, a write-in row, and Done; selecting a row toggles it, write-in calls `input`, Done completes, zero selections is valid, and cancellation cancels the set; `ctx.mode === "rpc"` selects this path; `index.test.ts` covers toggle state, Done, write-in, zero selection, and cancel.
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Files: see task text
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T36 [S45] (blocked-by: T34, T35): `before_agent_start` sets `event.systemPromptOptions.sections.question_format` only when `ctx.hasUI`, with a stable key and no forced prompt; the section teaches the exact fence, H2, ordered list, checkbox multi, implicit write-in, 0-8 options, no-tool turn ending, and follow-up answers; `index.test.ts` asserts content, gating, and no section in print/json.
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Files: see task text
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T37 [S44] (blocked-by: T36): `ctx.hasUI` gates both the prompt section and dialogs; print/json add no section and open no dialogs; `ctx.mode === "tui"` uses the custom multi-select path and `ctx.mode === "rpc"` uses the select-loop; `index.test.ts` covers each mode.
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts`
  - Files: see task text
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T38 [S50] (blocked-by: T31, T33): `pi-question` ignores unknown tags and fully closed malformed `question` blocks, leaving them visible; only valid question blocks trigger dialogs or display stripping; malformed input never crashes; `index.test.ts` and `questions.test.ts` cover unknown tags, mixed modes, 9+ options, reserved write-in, and open fences.
  - Verify: `npx vitest run extensions/pi-question/src/index.test.ts extensions/pi-question/src/questions.test.ts`
  - Files: see task text
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T39 [S49] (blocked-by: T38): `extensions/pi-question/package.json` removes `typebox`, `@earendil-works/pi-ai`, and `@earendil-works/pi-agent-core`, adds `@hollowheap/core` at `^0.2.0`, and keeps `pi-coding-agent`/`pi-tui`; `pi-question/README.md` and the core README document the fence format, no-tool flow, sequential TUI/RPC dialogs, implicit write-in, display-only TUI stripping, RPC raw-fence limitation, silent cancellation, and breaking removal; no package version bump; the root `pi.extensions` list is unchanged.
  - Verify: `! rg -l "registerTool|defineTool|typebox|@earendil-works/pi-ai|@earendil-works/pi-agent-core" extensions/pi-question/src extensions/pi-question/package.json && rg -q "'''question" extensions/pi-question/README.md && rg -q "blocks.ts" packages/core/README.md && jq -e '.pi.extensions | index("./extensions/pi-question/index.ts")' package.json >/dev/null`
  - Files: extensions/pi-question/package.json
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T40 [S49] (blocked-by: T39): full verification of the question-block initiative: `npm test`, `npm run typecheck`, and `npm run lint` are green, including the new core and pi-question tests.
  - Verify: `npm test && npm run typecheck && npm run lint`
  - Files: see task text
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T41 [S52] (blocked-by: none): scaffold `extensions/pi-todos` with `npm run new -- pi-todos`; set `@hollowheap/core` at `^0.2.0` in `dependencies`, keep `pi-coding-agent`/`pi-tui` as peers, remove any generated model-tool placeholder, keep version `0.2.0`, and ensure the root `pi.extensions` list contains `./extensions/pi-todos/index.ts`; `npm install` updates the workspace lock.
  - Verify: `jq -e '.pi.extensions | index("./extensions/pi-todos/index.ts")' package.json >/dev/null && ! rg -l "registerTool|defineTool|typebox|@earendil-works/pi-ai|@earendil-works/pi-agent-core" extensions/pi-todos/src extensions/pi-todos/package.json && npm run typecheck`
  - Files: extensions/pi-todos
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T42 [S54, S55] (blocked-by: T41): `extensions/pi-todos/src/todos.ts` parses `create_todos` and `complete_todos` bodies from the core AST into create/complete commands, rejecting any node other than exactly one ordered list, checkbox markers, unordered/empty lists, empty task text, and non-positive or leading-zero IDs; it exports pure append/complete/format/status/confirmation helpers with monotonic IDs and unknown-ID reporting; `todos.test.ts` covers valid, invalid, unknown-ID, append, and ID-boundary cases.
  - Verify: `npx vitest run extensions/pi-todos/src/todos.test.ts`
  - Files: extensions/pi-todos/src/todos.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T43 [S53, S56] (blocked-by: T42): `extensions/pi-todos/src/index.ts` registers no model tool; on assistant `message_end` with `ctx.hasUI` it scans text blocks, processes closed valid todo blocks in source order, ignores unknown/invalid/unclosed blocks, restores the latest `hollowheap.todos` custom entry from `getBranch()` on `session_start`/`session_tree`, appends one state entry per changed message, and sends one `hollowheap.todos.updated` follow-up (`display: true`, `deliverAs: "followUp"`) with the full ID list and unknown IDs; a renderer falls back to content; duplicate same-message events do not reapply; `index.test.ts` covers restore/persist, append/complete, confirmation, duplicate guard, and malformed input.
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts`
  - Files: extensions/pi-todos/src/index.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T44 [S57] (blocked-by: T43): `extensions/pi-todos/src/index.ts` registers `/todos`; TUI uses a closeable custom list with ID and done marker, RPC uses `ctx.ui.notify` with the same text, and print/json open no dialog; `ctx.ui.setStatus("todos", open/total)` updates after restore and every change and clears when empty; no widget is registered; `index.test.ts` covers the command and status.
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts`
  - Files: extensions/pi-todos/src/index.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T45 [S58, S59] (blocked-by: T43): `before_agent_start` sets a stable `sections.todos_format` only when `ctx.hasUI`, teaching both fences, ordered lists, numeric IDs, append semantics, confirmation, `/todos`, and no model tool; `registerMarkdownTransformer` strips valid closed todo blocks from assistant TUI markdown and open todo fences while streaming, leaving unknown tags, closed invalid blocks, non-assistant messages, code fences, stored text, and RPC text untouched; `index.test.ts` covers gating and each strip case.
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts`
  - Files: see task text
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T46 [S60] (blocked-by: T43, T44, T45): `todos.test.ts` and `index.test.ts` cover unknown tags, mixed valid/invalid blocks, checkboxes, unordered/empty lists, invalid IDs, unknown IDs, open fences, duplicate message events, and no-crash malformed input; only valid closed blocks mutate state or strip.
  - Verify: `npx vitest run extensions/pi-todos/src/index.test.ts extensions/pi-todos/src/todos.test.ts`
  - Files: see task text
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T47 [S61] (blocked-by: T44, T45, T46): `extensions/pi-todos/README.md` documents the fence format, no-tool flow, branch-local state, `/todos`, status count, TUI-only stripping, RPC raw fence, and print/json gating; the package manifest, root `pi.extensions`, and workspace lock are consistent; full suite is green.
  - Verify: `rg -q "'''create_todos" extensions/pi-todos/README.md && rg -q "hollowheap.todos" extensions/pi-todos/README.md && npm test && npm run typecheck && npm run lint`
  - Files: extensions/pi-todos/README.md
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T48 [S62] (blocked-by: T44): add `formatTodoWidget` to `extensions/pi-todos/src/todos.ts` and call `ctx.ui.setWidget("todos", ...)` from the shared UI update on restore and every state change; list up to five open todos with IDs, cap with `+N more (/todos)`, omit completed todos, and clear when none remain; cover formatting and extension updates in tests; document the widget and update decisions/specs.
  - Verify: `npx vitest run extensions/pi-todos/src/todos.test.ts extensions/pi-todos/src/index.test.ts && npm test && npm run typecheck && npm run lint`
  - Files: extensions/pi-todos/src/todos.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T49 [S65] (blocked-by: none): scaffold `extensions/pi-code-intel` with `npm run new -- pi-code-intel`; set `@hollowheap/core` at `^0.2.0` in `dependencies`, keep `pi-coding-agent`/`pi-ai` as peers, remove any generated tool placeholder, keep version `0.2.0`, and add `./extensions/pi-code-intel/index.ts` to the root `pi.extensions` list; implement `src/config.ts` with built-in mappings for TypeScript/JavaScript, Python, Rust, Go, C/C++, and Lua, the `extensions`-to-language-id schema, `<agentDir>/code-intel.json` overlay by server name, mtime-cached one-diagnostic-per-change validation, user-before-builtin suffix lookup, duplicate-suffix dropping, and missing-command hints; `config.test.ts` covers built-ins, overlay, precedence, invalid entries, and diagnostics.
  - Verify: `jq -e '.pi.extensions | index("./extensions/pi-code-intel/index.ts")' package.json >/dev/null && jq -e '.dependencies["@hollowheap/core"] == "^0.2.0"' extensions/pi-code-intel/package.json >/dev/null && npx vitest run extensions/pi-code-intel/src/config.test.ts && npm run typecheck`
  - Files: extensions/pi-code-intel, src/config.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T50 [S64] (blocked-by: T49): implement `src/lsp.ts` as a dependency-free stdio JSON-RPC client: Content-Length framing over UTF-8 buffers with partial/multiple messages, request ids and response routing, `initialize`/`initialized`, server-request replies, per-server serialization, lazy pooling keyed by command/args/root on a process-global symbol, full-text didOpen/didChange from disk with versions, 10s default/60s max timeouts, capped stderr, crash rejection, and best-effort shutdown/exit/kill on `session_start`/`session_shutdown`; `lsp.test.ts` uses a fixture Node LSP server and covers framing, routing, pooling, document sync, timeout, crash, and cleanup.
  - Verify: `npx vitest run extensions/pi-code-intel/src/lsp.test.ts`
  - Files: src/lsp.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T51 [S63, S65, S66] (blocked-by: T49, T50): implement `src/index.ts` and `src/tool.ts`: register exactly one `code_intel` tool with `exposure: "codemode"` and the action/parameter contract; validate action-specific fields; convert 1-based input positions; call definition/references/documentSymbol/workspaceSymbol; format locations, hierarchical symbols, and workspace symbols with caps and `... (truncated)`; check the target and every returned location through core `loadPermissions`/`checkPath` read rules; reject untrusted projects before spawn; resolve the server by file suffix, map language ids, return text for missing servers, timeouts, crashes, and denied paths; activate codemode on `session_start` if available; `tool.test.ts` and `index.test.ts` cover actions, conversion, formatting, caps, empty results, trust, denial, missing server, timeouts, registration, and cleanup.
  - Verify: `npx vitest run extensions/pi-code-intel/src/tool.test.ts extensions/pi-code-intel/src/index.test.ts && jq -e '.pi.extensions | index("./extensions/pi-code-intel/index.ts")' package.json >/dev/null && jq -e '.dependencies["@hollowheap/core"] == "^0.2.0"' extensions/pi-code-intel/package.json >/dev/null && rg -q 'name: "code_intel"' extensions/pi-code-intel/src && rg -q 'exposure: "codemode"' extensions/pi-code-intel/src && ! rg -q 'typebox' extensions/pi-code-intel/package.json`
  - Files: src/index.ts, src/tool.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T52 [S67] (blocked-by: T51): write `extensions/pi-code-intel/README.md` covering the four actions, 1-based positions, built-in mappings, config schema, trust gate and server process risk, no auto-install, codemode exposure, timeouts, caps, permissions, and read-only scope; update the root README package table; ensure the workspace lock includes the package; run the full suite.
  - Verify: `rg -q "code_intel" extensions/pi-code-intel/README.md && rg -q "code-intel.json" extensions/pi-code-intel/README.md && rg -q "pi-code-intel" README.md && npm test && npm run typecheck && npm run lint`
  - Files: extensions/pi-code-intel/README.md
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T53 [S68, S69] (blocked-by: none): scaffold `extensions/pi-tasks` with `npm run new -- pi-tasks`; set `@hollowheap/core` at `^0.2.0` in `dependencies`, keep `pi-coding-agent`/`pi-tui` as peers, remove `typebox` and any generated tool placeholder, keep version `0.2.0`, and add `./extensions/pi-tasks/index.ts` to the root `pi.extensions` list; implement `src/registry.ts` exporting `TaskRecord { id, kind, status, command?, cwd, pid?, startTime?, startedAt, finishedAt?, exitCode?, output, wait, cancel }` (`kind: "shell"` in v1, no `inbox`/`outbox`) with `<agentDir>/tasks/` (`0700`) and `<id>.json`/`<id>.log` (`0600`) persistence and atomic metadata writes; `registry.test.ts` covers record creation, `0600`/`0700` permissions, and atomic read/write.
  - Verify: `jq -e '.pi.extensions | index("./extensions/pi-tasks/index.ts")' package.json >/dev/null && jq -e '.dependencies["@hollowheap/core"] == "^0.2.0"' extensions/pi-tasks/package.json >/dev/null && ! rg -q 'typebox' extensions/pi-tasks/package.json && npx vitest run extensions/pi-tasks/src/registry.test.ts && npm run typecheck`
  - Files: extensions/pi-tasks, src/registry.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T54 [S70] (blocked-by: T53): implement `src/runner.ts` to spawn durable shell tasks via a detached Node runner shim (`process.execPath -e ...`, `detached: true`, `stdio: "ignore"`, `unref()`) that runs the shell command in its own process group, streams combined stdout/stderr to `<id>.log` (`0600`), records shim/child `pid` and OS process `startTime` (e.g. `/proc/<pid>/stat` field 22), and atomically writes `status`, `exitCode`, and `finishedAt` to `<id>.json` on exit; implement PID + `startTime` liveness reconciliation, cross-restart `wait` (watching/polling `<id>.json` + liveness), and process-group `cancel` (`SIGTERM` then `SIGKILL` grace); `runner.test.ts` and `registry.test.ts` cover detached survival, exit code recording, PID-reuse/dead-shim reconciliation, cross-restart wait, and cancel.
  - Verify: `npx vitest run extensions/pi-tasks/src/runner.test.ts extensions/pi-tasks/src/registry.test.ts`
  - Files: src/runner.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T55 [S71] (blocked-by: T53): update `extensions/pi-guard/src/index.ts` to gate `task` tool calls: evaluate `command` under `tag: "shell"` (blocking on `"deny"` and prompting via `ctx.ui.confirm` on `"ask"`) when `action === "start"` (or missing/unknown action), and allow `"list"`, `"status"`, `"wait"`, and `"cancel"` without a shell prompt; cover in `extensions/pi-guard/src/index.test.ts`.
  - Verify: `npx vitest run extensions/pi-guard/src/index.test.ts`
  - Files: extensions/pi-guard/src/index.ts, extensions/pi-guard/src/index.test.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T56 [S72] (blocked-by: T54): implement `src/task-tool.ts` registering the direct `task` tool (`name: "task"`, `exposure` omitted) supporting `action: "start" | "list" | "status" | "wait" | "cancel"`; `start` requires `ctx.isProjectTrusted()`, checks core shell permissions in `effectiveCwd`, spawns the detached runner shim, and returns task `id`/`pid`/log path immediately; `list` reconciles and formats all tasks in `<agentDir>/tasks/`; `status` returns reconciled metadata and `truncateText`-bounded log output; `wait` blocks until exit, `timeoutMs` (default 30s, max 600s), or abort without triggering unsolicited model turns; `cancel` terminates the process group and marks `cancelled`; unknown IDs, untrusted projects, denied commands, and validation errors return explanatory text without throwing; `task-tool.test.ts` covers all five actions, trust gate, permission denial, cross-restart wait, timeout, truncation, unknown IDs, and validation errors.
  - Verify: `npx vitest run extensions/pi-tasks/src/task-tool.test.ts`
  - Files: src/task-tool.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T57 [S68, S73] (blocked-by: T55, T56): implement `src/index.ts` wiring only the direct `task` tool (leaving built-in `bash` untouched and registering no `/background` command), statusline updates via `ctx.ui.setStatus("tasks", "<n> running")` (cleared when `0`), inert behavior when `PI_ACP` is set, and `session_shutdown` leaving durable tasks running; `index.test.ts` covers tool registration, status updates, ACP inertness, and `session_shutdown` durability.
  - Verify: `npx vitest run extensions/pi-tasks/src/index.test.ts && ! rg -q 'typebox|exposure: "codemode"' extensions/pi-tasks/src extensions/pi-tasks/package.json`
  - Files: src/index.ts
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

- [x] T58 [S74] (blocked-by: T57): write `extensions/pi-tasks/README.md` documenting the direct `task` tool (`start`/`list`/`status`/`wait`/`cancel`), keeping built-in `bash` untouched, `pi-guard` shell gating on `task.start`, the `<agentDir>/tasks/` `0600` durability and PID + `startTime` reconciliation model, the project trust gate, ACP inactivity, and the v1 task-layer scope; update the root `README.md` package table; ensure the workspace lock and full test/typecheck/lint suite are green.
  - Verify: `rg -q "pi-tasks" README.md && rg -q "start" extensions/pi-tasks/README.md && npm test && npm run typecheck && npm run lint`
  - Files: extensions/pi-tasks/README.md, README.md
  - Notes: Implemented as described in the canonical task; see the Verify command.
  - Risk: Regression in the covered behavior; the Verify command catches it.

## Open

- [x] T59 [S75] (blocked-by: none): scaffold `extensions/pi-web`, register it in the root suite, and keep host modules peer-only.
  - Verify: `npx vitest run extensions/pi-web/src/index.test.ts && npm run typecheck`
  - Files: `extensions/pi-web/package.json`, `extensions/pi-web/tsconfig.json`, `extensions/pi-web/index.ts`, `extensions/pi-web/src/index.ts`, `package.json`, `package-lock.json`
  - Notes: use the repo scaffold; no new runtime dependency; add the package to the root README table.
  - Risk: suite entry or workspace lock drift.

- [x] T60 [S76] (blocked-by: T59): register exactly `web_search` and `web_fetch` as direct tools without codemode activation.
  - Verify: `npx vitest run extensions/pi-web/src/index.test.ts`
  - Files: `extensions/pi-web/src/index.ts`, `extensions/pi-web/src/index.test.ts`
  - Notes: omit `exposure` or set `direct`; no session-start codemode calls.
  - Risk: accidental hidden/codemode exposure or a second tool.

- [x] T61 [S77] (blocked-by: T59): implement provider adapters for Tavily, Exa, and Firecrawl with one normalized search/fetch boundary.
  - Verify: `npx vitest run extensions/pi-web/src/providers`
  - Files: `extensions/pi-web/src/providers/*.ts`, `extensions/pi-web/src/providers/*.test.ts`
  - Notes: mock `fetch`; keep provider payload parsing private to each adapter.
  - Risk: payload drift or a provider-specific field leaking into the tool contract.

- [x] T62 [S78] (blocked-by: T61): implement `web_search`/`web_fetch` fields and result, character, link, and media caps.
  - Verify: `npx vitest run extensions/pi-web/src/tools.test.ts`
  - Files: `extensions/pi-web/src/tools.ts`, `extensions/pi-web/src/tools.test.ts`
  - Notes: search 5/10; fetch 20k/100k chars, 50 links, 20 media; report truncation.
  - Risk: missing fields, uncapped output, or wrong truncation flags.

- [x] T63 [S79] (blocked-by: T61): implement key detection, cheapest-first order, and provider fallback.
  - Verify: `npx vitest run extensions/pi-web/src/providers/selection.test.ts`
  - Files: `extensions/pi-web/src/providers/selection.ts`, `extensions/pi-web/src/providers/selection.test.ts`
  - Notes: search Exa → Tavily → Firecrawl; fetch Exa → Tavily → raw; 15s timeout.
  - Risk: selecting an unkeyed provider, stopping after a failure, or ignoring config order.

- [ ] T64 [S80] (blocked-by: T63): add `web.json` order-array loading with env-only keys and diagnostics.
  - Verify: `npx vitest run extensions/pi-web/src/config.test.ts`
  - Files: `extensions/pi-web/src/config.ts`, `extensions/pi-web/src/config.test.ts`
  - Notes: accept `search.order`/`fetch.order`; ignore `keys` with a diagnostic; never log env values.
  - Risk: accepting secrets from JSON or leaking keys in error text.

- [x] T65 [S81] (blocked-by: T61): implement the fetch chain with Exa/Tavily extract and dependency-free raw HTML extraction.
  - Verify: `npx vitest run extensions/pi-web/src/fetch.test.ts extensions/pi-web/src/extract.test.ts`
  - Files: `extensions/pi-web/src/fetch.ts`, `extensions/pi-web/src/extract.ts`, `extensions/pi-web/src/fetch.test.ts`, `extensions/pi-web/src/extract.test.ts`
  - Notes: static text only; no browser; handle HTML, text, and non-text content types.
  - Risk: returning raw HTML, invoking a browser, or dropping content-type handling.

- [ ] T66 [S82] (blocked-by: T65): add URL validation and redirect safety to `web_fetch`.
  - Verify: `npx vitest run extensions/pi-web/src/url.test.ts`
  - Files: `extensions/pi-web/src/url.ts`, `extensions/pi-web/src/url.test.ts`, `extensions/pi-web/src/fetch.ts`
  - Notes: only http/https; reject loopback/private/link-local/metadata and credentialed URLs; revalidate each hop; cap 5.
  - Risk: private redirect targets, unlimited hops, or non-http schemes.

- [x] T67 [S83] (blocked-by: none): tag `web_search` as `search` and `web_fetch` as `read` in `pi-guard`.
  - Verify: `npx vitest run extensions/pi-guard/src/index.test.ts`
  - Files: `extensions/pi-guard/src/index.ts`, `extensions/pi-guard/src/index.test.ts`, `extensions/pi-guard/README.md`
  - Notes: add built-in entries; user `tools` entries cannot override them.
  - Risk: falling into unknown-tool approval or allowing a user override.

- [ ] T68 [S84] (blocked-by: T60, T62, T65, T67): document the web-tool contract in package and root docs.
  - Verify: `rg -q "TAVILY_API_KEY" extensions/pi-web/README.md && rg -q "pi-web" README.md`
  - Files: `extensions/pi-web/README.md`, `README.md`, `AGENTS.md`, `artifacts/context.md`
  - Notes: list providers, env keys, order arrays, shapes, caps, media, no-rendering limit, and fallback order.
  - Risk: stale provider list or undocumented security limits.

- [ ] T69 [S85] (blocked-by: T62): prove there is no response cache.
  - Verify: `npx vitest run extensions/pi-web/src/tools.test.ts`
  - Files: `extensions/pi-web/src/tools.test.ts`
  - Notes: two identical calls must invoke the provider twice.
  - Risk: hidden cache or stale results across calls.

- [ ] T70 [S86] (blocked-by: T62, T65): extract links and media metadata with caps and no binary payloads.
  - Verify: `npx vitest run extensions/pi-web/src/tools.test.ts`
  - Files: `extensions/pi-web/src/extract.ts`, `extensions/pi-web/src/tools.ts`, `extensions/pi-web/src/tools.test.ts`
  - Notes: classify image/video/audio/pdf/other; cap 50 links and 20 media; never return base64.
  - Risk: downloading media, exceeding caps, or misclassifying kinds.

- [x] T85 [S88] (blocked-by: none): scaffold `pi-classifier` and register one direct `decide` tool for choice/score/bool questions.
  - Verify: `npx vitest run extensions/pi-classifier/src/index.test.ts extensions/pi-classifier/src/decide.test.ts`
  - Files: `extensions/pi-classifier/package.json`, `extensions/pi-classifier/tsconfig.json`, `extensions/pi-classifier/index.ts`, `extensions/pi-classifier/src/index.ts`, `extensions/pi-classifier/src/decide.ts`, `extensions/pi-classifier/src/decide.test.ts`, `extensions/pi-classifier/src/index.test.ts`, `package.json`, `package-lock.json`
  - Notes: direct exposure; one question per call; return label/score/probability, confidence, model, usage.
  - Risk: extra tools, codemode exposure, malformed label schema.

- [x] T86 [S89] (blocked-by: T85): add explicit `classifier.json` model resolution with no first-available fallback.
  - Verify: `npx vitest run extensions/pi-classifier/src/config.test.ts`
  - Files: `extensions/pi-classifier/src/config.ts`, `extensions/pi-classifier/src/config.test.ts`, `extensions/pi-classifier/src/decide.ts`, `extensions/pi-classifier/README.md`
  - Notes: require `provider/model-id`; validate timeout, input cap, cache TTL; use `getModelOfType("classifier", ...)`.
  - Risk: fallback model selection, wrong model type, unconfigured auth.

- [x] T87 [S90] (blocked-by: T85): enforce input cap, timeout, and explanatory capability errors.
  - Verify: `npx vitest run extensions/pi-classifier/src/decide.test.ts`
  - Files: `extensions/pi-classifier/src/decide.ts`, `extensions/pi-classifier/src/decide.test.ts`
  - Notes: 20k default input cap; 5s default timeout; abort signal; errors as text, no session mutation.
  - Risk: provider error, abort, timeout, missing config, unavailable auth.

- [x] T88 [S91] (blocked-by: T85): add per-session result cache and in-flight dedupe.
  - Verify: `npx vitest run extensions/pi-classifier/src/decide.test.ts`
  - Files: `extensions/pi-classifier/src/cache.ts`, `extensions/pi-classifier/src/decide.ts`
  - Notes: key model/kind/question/criteria/input; TTL from config; failed/aborted calls not cached.
  - Risk: stale TTL, key collision, duplicate concurrent provider calls.

- [x] T89 [S92] (blocked-by: T85, T86, T87, T88): document advisory use and verify direct-only exposure.
  - Verify: `npx vitest run extensions/pi-classifier/src/index.test.ts && rg -q "decide" extensions/pi-classifier/README.md`
  - Files: `extensions/pi-classifier/README.md`, `extensions/pi-classifier/src/index.test.ts`, `package.json`, `README.md`, `AGENTS.md`, `artifacts/context.md`
  - Notes: direct tool, no codemode activation, no CLI, no service registry; warn that input is sent to the classifier.
  - Risk: hidden/codemode exposure, extra tools, undocumented privacy limits.

- [x] T90 [S93] (blocked-by: T85): restrict the classifier payload to caller-supplied input, question, and criteria.
  - Verify: `npx vitest run extensions/pi-classifier/src/decide.test.ts`
  - Files: `extensions/pi-classifier/src/decide.ts`, `extensions/pi-classifier/src/decide.test.ts`
  - Notes: state contains input only; no cwd/mode/session/files/tool output.
  - Risk: automatic context enrichment, file reads, hidden session data.

- [x] T91 [S94] (blocked-by: none): add a process-wide FIFO prompt queue in core and route every blocking `pi-question`/`pi-guard` dialog through it.
  - Verify: `npx vitest run packages/core/src/prompt-lock.test.ts extensions/pi-question/src/index.test.ts extensions/pi-guard/src/index.test.ts`
  - Files: `packages/core/src/prompt-lock.ts`, `packages/core/src/prompt-lock.test.ts`, `packages/core/src/index.ts`, `extensions/pi-question/src/index.ts`, `extensions/pi-question/src/index.test.ts`, `extensions/pi-guard/src/index.ts`, `extensions/pi-guard/src/index.test.ts`
  - Notes: release on resolve/reject/cancel/throw; reject nested acquisition; serialize only blocking prompts, not status/widgets/headers/todo views.
  - Risk: duplicate queues across module roots, lost release on rejection, reentrant deadlock, serializing non-prompt UI.
