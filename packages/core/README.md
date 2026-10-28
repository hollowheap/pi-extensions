# @hollowheap/core

Runtime foundation shared by the Hollowheap Pi extensions: permission rules, path and shell analysis, the mode registry, and the session state store. This is a library, not an extension: it registers nothing with pi and has no `pi.extensions` entry.

## Installation

Consumers list the package in `dependencies` (not `devDependencies`), so pi installs it with the extension:

```json
"dependencies": {
  "@hollowheap/core": "^0.2.0"
}
```

The version moves together with the extension packages: every workspace package is published as `0.2.0` and every consumer depends on `^0.2.0`.

## What lives here

- `policy.ts` — `checkPath`, `matchPath`, `matchPathSpecific`: path matching for the `edit`, `read`, and `search` tags (glob patterns, symlink-safe root checks, specificity and deny-first resolution).
- `config.ts` — `loadPermissions` and `loadModesConfig`: mtime-cached JSON config with once-per-change diagnostics.
- `shell.ts` — `checkShell` and the `splitShellParts`/`shellPartSafety`/`matchShellPart` helpers: shell command splitting, hard safety, and rule matching on token boundaries.
- `exec.ts` — `runBinary`: bounded subprocess runner (max buffer, abort signal, exit-code allowlist, `command not found`/missing-cwd diagnostics) plus `clampMaxResults`. `runCapture` is the same runner with optional stdin; it resolves `{ code, stdout, stderr }` for any exit code instead of throwing, so a caller can tell "the command decided" from "the command failed".
- `sandbox.ts` — `wrapSandboxCommand`, `buildSandboxArgs`, `isBwrapAvailable`: Bubblewrap (`bwrap`) OS-level sandbox wrapper isolating shell commands with read-only root, tmpfs mounts, masked credential paths, and workspace-only writable bind mount.
- `format.ts` — `truncateText` (4000-char threshold, 3000 head + 1000 tail), `displayTarget` (500-char ellipsis), `displayPath` (relative posix path).
- `blocks.ts` — `scanTaggedBlocks` (finds `'''tag` … `'''` blocks, ignores markdown code fences, reports offsets and unclosed state) and `parseMarkdownBlocks` (minimal heading/list/listItem/paragraph AST with ordered and optional checked state). Host-free; shared with `pi-question` and future tagged-block consumers.
- `state.ts` — `session`, `setMode`, `setCwd`, `effectiveCwd`, `dropSession`, `resetSession`: the per-session store keyed by the pi session owner.
- `modes.ts` — `registerMode`, `registerModeGate`, `replaceConfigModes`, `enterMode`, `resetSession`, and `evaluate`: the mode registry, entry gates, and the five-step verdict ladder.
- `prompt-lock.ts` — `withPromptLock`: process-wide FIFO queue for blocking UI prompts; releases on settle or throw and rejects nested acquisition.
- `types.ts` — `Tag`, `Effect`, `Verdict`, `Rule`, `ModeLayer`, `ModeNotice`, `ModeEnter`.

## Permission rules

Rules live in `<agentDir>/permissions.json` (default `~/.pi/agent/permissions.json`) and, for trusted projects only, in `<project>/.pi/permissions.json`:

```json
{
  "rules": [
    "deny edit *",
    "allow edit artifacts/specs/*.md",
    "ask shell git push"
  ]
}
```

Each rule is `"effect tag pattern"` or `{ "effect", "tag", "pattern" }`. `effect` is `allow`, `ask`, or `deny`; `tag` is `edit`, `read`, `search`, or `shell`. Patterns match the whole path relative to the workspace root; `*` spans directories and `?` matches one character.

Unknown tool names can be tagged in the same file:

```json
{
  "tools": {
    "mcp__docs__search": "search",
    "mcp__docs__read": "read"
  }
}
```

`loadToolTags` returns the merged `tools` map. Invalid tags are diagnosed and ignored. Consumers decide whether their built-in tool mappings override this map; `pi-guard` keeps its built-ins authoritative.

The project overlay is ignored (with a diagnostic) when the project is not trusted. Missing or unreadable files yield no rules, and the mode default then decides.

## Mode layers

Modes are declarative layers: `defaults` per tag plus restrictive `overrides`. Core registers `ask`, `edit`, and `plan`; `pi-autopilot` registers `autopilot`; user layers come from `<agentDir>/modes.json`:

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

`defaults` must cover all four tags (a missing tag drops the layer with a diagnostic). `overrides` accept only `ask`/`deny`; an `allow` override is diagnosed and ignored. Names that collide with a built-in or package layer are rejected with a diagnostic. Config layers are replaced wholesale on every session start; built-in and package layers persist.

A layer may carry a `description` (one line of prose). Core does not render it; the ACP adapter forwards it to the client as the mode's option description.

## Verdict ladder

`evaluate()` resolves every call in a fixed order, so rule array order never decides:

1. hard safety (target outside the workspace root, empty command, dangerous interpreters, redirects, command or process substitution) → `deny`;
2. explicit `deny` rules → `deny`;
3. the active mode's overrides (restrictive `ask`/`deny` only);
4. merged `allow`/`ask` rules by highest pattern specificity, ties toward the stricter effect;
5. the active mode's default for the tag.

## Mode persistence

The active mode is appended to the session as the custom entry `hollowheap.core.mode` (`{ "mode": "…" }`) whenever it changes, and `resetSession` restores it from `getEntries()` on resume or fork. A restored mode that no longer exists falls back to `ask` with a diagnostic, and restoring re-runs the entry gates (a veto falls back to `ask`).

## State ownership

All shared state lives on the process-global registry `globalThis[Symbol.for("@hollowheap/core/state")]`, never in module-level variables: pi loads each extension with a fresh module instance and gives installed packages separate module roots, so module-level state would be duplicated. Consumers therefore never share state through event envelopes; they call core directly.
