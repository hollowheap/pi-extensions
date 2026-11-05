# Changelog

## Unreleased

### Added

- `pi-subagents`: the `subagent` tool's `define` action creates session-only agent definitions. Definitions persist as session custom entries, restore from the active branch, and shadow file agents with the same name.
- `pi-subagents`: the `delete` action removes session definitions with a tombstone entry and refuses file agents. New definitions are bounded by `maxSessionAgents` and `maxSessionAgentBytes` in `subagents.json`.

### Fixed

- `pi-subagents`: `define` results render as a named session agent instead of an empty child row.
- `pi-subagents`: a failed or malformed branch read clears session definitions instead of leaving definitions from the previous branch active.

## 0.3.0 — 2026-11-05

Coordinated release of the extension suite.

### Breaking

- `@hollowheap/pi-classifier` is now `@hollowheap/pi-decide`.
- `classifier.json` is now `decide.json`. The old file is still read with a deprecation warning, but it will be removed in a later release.
- `@hollowheap/process` is now `@hollowheap/runtime`.
- `runCapture`, `runBinary`, `clampMaxResults`, and sandbox helpers moved from `@hollowheap/core` to `@hollowheap/runtime`.
- `pi-agent` no longer replaces the Pi system prompt from agent Markdown bodies. Frontmatter still switches model, mode, thinking, tools, and skills.
- Package imports of `@hollowheap/process/*` must become `@hollowheap/runtime/*`.

### Added

- `@hollowheap/tui`: rounded frames, fuzzy picker, Markdown pager, cancellable progress, and code viewer.
- `@hollowheap/policy`: headless permission enforcement and shared tool-category/target helpers.
- Open permission categories, including the built-in `external` category for URLs, queries, and model actions.
- `pi-web` activates codemode on session start when the built-in extension is registered.
- `pi-modal`: vim-mode border colors, prompt spill layout, `c`/`C` changes, Kitty CSI-u input, theme-driven breathing indicator, `/expand`, `ctrl+shift+o` codemode viewer, and `/vimkeys` with `ctrl+shift+k`.
- `pi-agent`: rounded picker and activation popups, plus `/agents` as an alias for `/agent`.

### Changed

- Usage ledger, budget state, and compaction restore moved to `@hollowheap/core/usage`; `pi-usage` is presentation, subagent scanning, and statusline integration.
- `LockedProcessStore` and `detached task` lifecycle moved to `@hollowheap/runtime`; `pi-tasks` re-exports `TaskStore` for compatibility.
- The extension dependency graph is flat: no extension depends on another extension.
- Package versions are coordinated at `0.3.0`.

### Fixed

- `pi-guard` resolves approval targets for web URLs, search queries, `lang` paths, and `decide` calls.
- `pi-decide` timeout handling is deterministic in tests.
