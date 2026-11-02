# Review — ui-upgrades (V17)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`

Status: Idea inventory. Date: 2026-10-30.
Scope: extension UI opportunities using `@earendil-works/pi-tui` and `ctx.ui`.


## Requirements Review

N/A — package robustness review; traceability is recorded in the Code Review findings.

## Design Review

N/A — package robustness review; see `artifacts/architecture.md`.

## Specification Review

N/A — package robustness review; verify commands are recorded under Code Review.

## Plan Review

N/A — package robustness review; tasks remain in `artifacts/plan.md`.

## Code Review

### Current Usage

The suite already uses:

- `Text` for tool/result rendering and custom overlays.
- `ctx.ui.custom` overlays for agent, question, and todo flows.
- `ctx.ui.setWidget`, `setHeader`, `setFooter` for todo/dashboard/statusline surfaces.
- `ctx.ui.notify`, `select`, `confirm`, `input`, `setStatus`, `onTerminalInput`.
- `setEditorComponent` for the modal editor.
- `visibleWidth`, `truncateToWidth`, colors, key matching, and theme helpers.

The suite does not use the richer component set: `Markdown`, `Image`,
`ScrollView`, `Loader`, `CancellableLoader`, `SelectList`, `SettingsList`,
`MouseRegion`, `VStack`, `HStack`, `Box`, `Spacer`, `CombinedAutocompleteProvider`,
`Editor`, `Input` as a component, `renderLatex`, or `hyperlink`.

### Upgrade Candidates

| Upgrade | pi-tui pieces | Best fit | Why |
| --- | --- | --- | --- |
| Scrollable Markdown pager | `Markdown`, `Text`, `ScrollView` | `pi-web`, `pi-language-tools`, `pi-tasks`, `pi-subagents` | Long tool output becomes readable instead of notify/truncation. |
| Cancellable progress overlay | `CancellableLoader`, `Loader` | web fetch, LSP startup, subagent wait, long task start | Escape can cancel work and show live progress. |
| Fuzzy picker with preview | `SelectList`, `fuzzyFilter` | `/agent`, `/task`, `/subagent`, `/grant` | Searchable selection with descriptions/previews. |
| Settings panel | `SettingsList` | `/statusline`, `/dashboard`, `/budgets`, `/web`, `/todos` | Cycle values and open submenus without hand-written argument parsing. |
| Inline media and links | `Image`, `hyperlink`, OSC 8 | `pi-web` results and fetched media | Inline images where the terminal supports Kitty/iTerm2; clickable URLs. |
| Responsive layout primitives | `HStack`, `VStack`, `Box`, `Spacer` | `pi-statusline`, `pi-dashboard`, `pi-todos` widgets | Width-aware composition instead of manual string padding. |
| Custom widget components | `ctx.ui.setWidget` component factory | todo panel, task/subagent panel | Current widgets are `string[]`; components can be richer and stateful. |
| Multi-line prompt input | `ctx.ui.editor()`, `Editor` | `pi-question` free-text answers, long follow-ups | Better than single-line `input()` for prose. |
| Custom autocomplete | `ctx.ui.addAutocompleteProvider`, `CombinedAutocompleteProvider` | `/agent`, `/grant`, `@`-file workflows | Dynamic argument/file completion without bespoke parsing. |
| Working indicator and title | `ctx.ui.setWorkingMessage`, `setWorkingIndicator`, `setWorkingVisible`, `setHiddenThinkingLabel`, `setTitle` | every TUI extension | Cheap, visible polish: mode/task title, custom spinner, clearer thinking state. |
| Clipboard/prompt insertion | `ctx.ui.pasteToEditor`, `setEditorText`, `getEditorText` | web results, code-intel, tasks | “Insert this into the prompt” actions. |
| Theme picker | `getAllThemes`, `getTheme`, `setTheme` | new `/theme` command or settings panel | Live theme selection/preview. |
| Math rendering | `renderLatex` | `pi-web` docs, code-intel docs | Niche: only useful for math-heavy content. |
| Mouse and alt-screen navigation | `MouseRegion`, `TuiAltScreen`, `ScrollView` | full-screen logs/dashboard | Powerful, but host-dependent. |

### Cheap Wins

These need little new structure:

1. Set terminal title from the active agent/mode/task.
2. Show a custom working message during long operations.
3. Customize the hidden-thinking label.
4. Use `ctx.ui.editor()` for multi-line write-in answers.
5. Add “insert result into prompt” via `pasteToEditor`/`setEditorText`.
6. Add dynamic autocomplete providers for command arguments.
7. Use `HStack`/`Spacer` in custom footer/header renderers.

### Bigger Slices

1. **Markdown pager**: reusable overlay component with keyboard paging, plus
   Markdown rendering for `web_search`/`web_fetch` and code-intel docs.
2. **Fuzzy command palettes**: custom `SelectList` overlays for agent, task,
   subagent, and grant selection; preview pane shows metadata.
3. **Settings UI**: shared `SettingsList` patterns for package config commands.
4. **Media viewer**: inline image previews for fetched media, with terminal
   capability fallback.
5. **Full-screen logs**: alt-screen `ScrollView` for task/subagent transcripts.

### Constraints

- The interactive host currently uses `TuiMainScreen`, not `TuiAltScreen`.
- `TuiMainScreen` does not capture mouse input; mouse-first designs only make
  sense after host alt-screen support.
- `ScrollView` is designed for viewport layout; in a main-screen overlay, use a
  custom pager or wait for alt-screen integration.
- Inline images require Kitty/iTerm2 protocol support and must fall back to text.
- `setWidget` string arrays are capped by the host; custom component factories
  are the escape hatch for richer widgets.
- Every `render(width)` line must fit the width; use the pi-tui width helpers.
- Extensions should guard TUI-only behavior with `ctx.mode === "tui"` or
  `ctx.hasUI`.

### Recommended Order

1. Markdown pager for long tool results.
2. CancellableLoader for long operations.
3. Fuzzy picker for agent/task/subagent selection.
4. SettingsList for configuration commands.
5. Inline media/hyperlinks.
6. Responsive widget/header/footer composition.

### References

- `node_modules/@earendil-works/pi-tui/README.md`
- `node_modules/@earendil-works/pi-tui/dist/index.d.ts`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- `extensions/pi-web/src/tools.ts`
- `extensions/pi-todos/src/index.ts`
- `extensions/pi-dashboard/src/index.ts`
- `extensions/pi-statusline/src/index.ts`
- `extensions/pi-question/src/index.ts`
- `extensions/pi-agent/src/popup.ts`

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — existing review record; formatting only.
