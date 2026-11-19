import type { ModeLayer } from "@hollowheap/core/types";

/** Default approval layer: reads pass, writes and shell ask. */
export const MANUAL_MODE: ModeLayer = Object.freeze({
  name: "manual",
  source: "builtin",
  defaults: Object.freeze({
    read: "allow",
    search: "allow",
    edit: "ask",
    shell: "ask",
    external: "allow",
  }),
});

/** Edits pass, shell asks. */
export const EDIT_MODE: ModeLayer = Object.freeze({
  name: "edit",
  source: "builtin",
  defaults: Object.freeze({
    read: "allow",
    search: "allow",
    edit: "allow",
    shell: "ask",
    external: "allow",
  }),
});

/** Plan-only mode: edits are denied except the plan/spec artifacts. */
export const PLAN_MODE: ModeLayer = Object.freeze({
  name: "plan",
  source: "builtin",
  defaults: Object.freeze({
    read: "allow",
    search: "allow",
    edit: "deny",
    shell: "ask",
    external: "allow",
  }),
  overrides: Object.freeze([
    Object.freeze({ tag: "edit", pattern: "artifacts/plan.md", effect: "ask" }),
    Object.freeze({
      tag: "edit",
      pattern: "artifacts/specs.md",
      effect: "ask",
    }),
    Object.freeze({ tag: "edit", pattern: "*", effect: "deny" }),
  ]),
});

export const AUTO_MODE: ModeLayer = Object.freeze({
  name: "auto",
  source: "builtin",
  description: "Writes and non-destructive bash run without asking",
  defaults: Object.freeze({
    read: "allow" as const,
    search: "allow" as const,
    edit: "allow" as const,
    shell: "allow" as const,
    external: "allow" as const,
  }),
  onEnter: () => ({
    notice: {
      text: "auto on: writes and non-destructive bash run without asking",
      level: "warning" as const,
    },
  }),
});

export const BUILTIN_MODE_LAYERS: readonly ModeLayer[] = Object.freeze([
  MANUAL_MODE,
  EDIT_MODE,
  PLAN_MODE,
  AUTO_MODE,
]);
