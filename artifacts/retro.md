# Retrospective: Workspace Enhancements & Prompt Minimization

Conducted at 2026-10-27T01:25:00+08:00 across 507 conversation steps.

## Tool Efficiency & Errors

### Metrics Summary
- **Total Steps**: 507
- **Total Tool Calls**: 238
  - `run_command`: 118
  - `view_file`: 89
  - `replace_file_content`: 26
  - `write_to_file`: 3
  - `manage_task`: 2
  - `ask_question`: 1
  - `invoke_subagent`: 0
- **Command Non-Zero Exits**: 13 (11.0% failure rate across 118 `run_command` calls)

### Failure Taxonomy
1. **Tooling & Environment Paths (2)**:
   - `scripts/artifacts.sh unconverted-decs` exited 127: assumed `artifacts.sh` was in `$PATH`.
   - `find /nix/store ...` exited 1: broad search without permissions/depth limits.
2. **Search / Pattern Misses (5)**:
   - `rg` queries (`subagents:`, `interface ExtensionContext`, `<docs>`, `registerFlag`, `docs` in settings) returned exit code 1 when patterns differed from assumptions.
3. **Premature / Compound Test Execution (3)**:
   - Ran `npx vitest` before the target test file was written (`context.test.ts`).
   - Compound commands (`npx vitest ... && npm run typecheck && npm run lint`) compounded failures across test assertions and Biome linter errors.
4. **API Speculation & Imports (3)**:
   - Speculative `node -e` snippet guessed `buildSystemPrompt` function name on package root (TypeError).
   - Missing `afterEach` in `vitest` imports in `pi-hooks/src/index.test.ts`.
   - Biome `lint/performance/noDelete` triggered on `delete process.env.*`.

## Rule Compliance

- **`lazy` (YAGNI & minimal diffs)**: Strong. No speculative generalizations or helper functions added. In `pi-todos`, only minimal rendering and event subscriptions were introduced. In `pi-hooks`, `resources_discover` was cleanly gated behind `PI_HOOKS_DISCOVER_SKILL=1`.
- **`unslop` (Communication density)**: Strong. Strict <=20 word sentence constraints observed, answered first, eliminated conversational filler, kept paths and commands verbatim.
- **`report` (Formula compliance)**: 100% compliant. Every turn ended with verbatim `Done: ... / Verified: ... / Next: ...` without trailing conversational recaps.
- **Subagent Delegation Boundary**: Deficient. Exploration of `node_modules/@earendil-works/` and deep grep searches ran in the main context instead of delegating to `scout`, consuming valuable main conversation context window.

## Winning Patterns

1. **Precision Slice Inspection**: Using `view_file` with explicit slice ranges (30-40 lines) avoided token waste on large files like `decisions.md` (564 lines) and `specs.md` (1157 lines).
2. **Batch Interactive Clarification**: Handled the D107 UI presentation choice (statusline vs sticky widget) using a single `ask_question` invocation before touching code, avoiding speculative rework.
3. **Prompt Footprint Auditing**: Successfully identified that bundled extension skills inject prompt bloat into every session via `resources_discover`, and established an opt-in gating pattern (`PI_HOOKS_DISCOVER_SKILL=1`).

## Actionable Improvements

### 1. Rule Adjustments (`~/.gemini/config/rules/`)
- **`subagent-io.md` / `lazy.md`**: Forbid inline speculative `node -e` scripts guessing host package APIs. Require static AST inspection or slice reads of `node_modules` via Scout before executing dynamic harness probes.
- **Testing Rule**: Enforce running isolated unit test files (`npx vitest run <file>`) before running compound verification (`typecheck && lint`).

### 2. Repo Conventions (`AGENTS.md`)
- **Process Environment Cleanups in Tests**: Document that Biome forbids `delete process.env.KEY`; tests must use `Reflect.deleteProperty(process.env, "KEY")`.
- **Extension Resource Discovery**: Document that extensions must not register unconditional `resources_discover` skills that bloat the system prompt unless explicitly requested or opted in via environment flags.
