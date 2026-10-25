# Requirements

- [x] R08: Shared policy, config, state, and subprocess primitives live in `@hollowheap/core` and every consumer uses them.
  - Verify: Core tests and consumer integration tests pass; no vendored policy copies remain.
  - Acceptance: One implementation serves TUI and ACP; shared state survives module duplication; core stays host-free.
  - Duplicated policy caused drift and inconsistent permissions.

- [x] R09: Rules, modes, and precedence produce deterministic verdicts from data.
  - Verify: Core policy and mode tests pass, including specificity and restore cases.
  - Acceptance: Effects are `allow|ask|deny`; mode layers are declarative; array order never decides.
  - Deterministic, order-independent policy is easier to test and audit.

- [x] R10: Consumer packages delegate policy to core and keep only their UI or transport responsibilities.
  - Verify: Consumer suites pass and no package reimplements rule parsing or shell analysis.
  - Acceptance: `pi-guard` owns prompting, budgets owns caps, tools owns search/cwd, ACP owns transport.
  - One owner per concern keeps behavior aligned across harnesses.

- [x] R11: The ACP adapter routes execution through client capabilities and keeps built-ins from bypassing them.
  - Verify: ACP adapter and extension tests pass, including spawn args and lifecycle cases.
  - Acceptance: One pi child per session, socket transport, permission correlation, bounded terminal polling.
  - ACP clients must remain the only execution path.

- [x] R12: Statusline and dashboard extend the UI without breaking narrow terminals or shutdown.
  - Verify: UI package tests pass, including width and abort cases.
  - Acceptance: Extension segments render consistently; in-flight commands stop on shutdown.
  - UI regressions are user-visible and hard to catch in logic tests.

- [x] R13: Modes persist across resume/fork and can be extended by user config without shadowing built-ins.
  - Verify: Core, guard, and ACP mode tests pass.
  - Acceptance: Mode state survives branches; `modes.json` validates and replaces config layers on reload.
  - A resumed autopilot session must not bypass its gates.

- [x] R14: Permissions, budgets, release versioning, and ACP permission timing have one documented contract.
  - Verify: Core, guard, budgets, and ACP tests pass.
  - Acceptance: Agent rules plus trusted overlay; usage baseline plus deltas; `^0.2.0` consumers; client-decided permissions.
  - Cross-package releases and permissions need one reference.

- [x] R15: `pi-hooks` runs configured commands at session start and around tool calls.
  - Verify: `extensions/pi-hooks/src` tests pass.
  - Acceptance: Pre-hooks fail closed; post-hooks append output; session hooks warn only; trusted overlay only.
  - Hooks let the model install checks without writing an extension.

- [x] R16: `fd`/`rg` are callable from scripts without changing the declared tool set.
  - Verify: `pi-tools` tests pass.
  - Acceptance: Both register as codemode tools; `tool_search` stays disabled.
  - This preserved a stable prefix before direct exposure became the default.

- [x] R17: Questions are tool-free tagged blocks answered through UI dialogs.
  - Verify: `pi-question` tests pass.
  - Acceptance: Valid blocks parse, dialogs cancel safely, answers return as one follow-up, print/json stay inert.
  - The user wanted questions in the response format, not a tool round trip.

- [x] R18: Todos are tool-free tagged blocks with branch-local state.
  - Verify: `pi-todos` tests pass.
  - Acceptance: Create appends with stable IDs, complete marks done, state restores, `/todos` and status show progress.
  - Branch-local state keeps resume and fork coherent.

- [x] R19: Code intelligence is read-only LSP navigation with trust and path checks.
  - Verify: `pi-code-intel` tests pass.
  - Acceptance: Definition/references/symbols use 1-based positions, pooled servers, bounded output, explanatory failures.
  - The model should navigate by editor coordinates without gaining write access.

- [x] R20: Durable background shell tasks survive pi exit and stay under shell policy.
  - Verify: `pi-tasks` tests pass.
  - Acceptance: Start/list/status/wait/cancel; detached runner; PID/start-time reconciliation; trust gate; ACP inert.
  - Long-running work must not require a live foreground shell.

- [x] R21: Tool exposure, guard tags, and todo widget density are user-visible defaults.
  - Verify: `pi-tools`, `pi-code-intel`, `pi-guard`, and `pi-todos` tests pass.
  - Acceptance: Direct tools by default; configurable exposure; MCP tag map; ten-row todo widget.
  - Single-call tools belong in the direct schema; codemode is for orchestration.

## Open Questions

None.

- [x] R22: The suite is split into core plus focused packages, with the final split verified green.
  - Verify: Final suite, typecheck, and lint pass after the split.
  - Acceptance: Core owns runtime foundations; guard, tools, budgets, autopilot, statusline, dashboard, and question are separate packages.
  - The split replaced the monolithic mode-guard package without changing behavior.

- [ ] R01: A standalone web-tools extension exposes `web_search` and `web_fetch` as direct tools and is included in the git suite.
  - Verify: Installing the suite or the package alone registers exactly these two tools; the full test suite and typecheck pass.
  - Acceptance: No other package owns the tools; both are direct, not codemode.
  - Coding agents need current docs and web results without adding a browser stack.

- [ ] R02: `web_search` returns one normalized result shape regardless of provider.
  - Verify: Tests cover each provider adapter and fallback with the same output fields.
  - Acceptance: Each result has `title`, `url`, `snippet`, and `provider`; failures fall through; results are capped and truncation is reported.
  - Provider APIs disagree on field names and nesting, so the model should not branch per provider.

- [ ] R03: `web_fetch` returns readable page content for a URL with a normalized result shape.
  - Verify: Tests cover provider extract, raw fallback, caps, and media metadata.
  - Acceptance: Each fetch has `url`, `finalUrl`, `provider`, `contentType`, `content`, `links`, `media`, and `truncated`; no headless-browser mode; media is metadata only; links cap at 50 and media at 20.
  - Search snippets are insufficient for API docs and long pages.

- [ ] R04: Provider keys and selection are user configurable without editing code.
  - Verify: Tests cover env keys, `web.json` order arrays, missing keys, and invalid entries.
  - Acceptance: Keys come only from environment variables; `web.json` contains only search/fetch order arrays; unkeyed providers are skipped; configured order wins; errors never include keys.
  - Free tiers change and keys differ per machine.

- [ ] R05: `web_fetch` refuses internal targets.
  - Verify: Tests cover private, loopback, link-local, metadata, non-http(s), and redirect targets.
  - Acceptance: Only `http`/`https`; private targets rejected on every hop; redirects capped; rejection returns explanatory text.
  - A URL tool that can reach internal networks is an SSRF primitive.

- [ ] R06: Web tools obey `pi-guard` policy.
  - Verify: Guard tests cover both tool names and built-in tag precedence.
  - Acceptance: `web_search` tags as `search`, `web_fetch` as `read`, without user config; built-ins stay authoritative.
  - Network reads cross a trust boundary just like local reads.

- [ ] R07: Configuration and provider behavior are documented.
  - Verify: Package and root README checks pass; docs list providers, env keys, order arrays, shapes, caps, media, and no rendering.
  - Acceptance: Users can audit what leaves the machine and how fallback works.
  - Provider terms and limits change, so the contract must stay visible.

## Open Questions

None.
