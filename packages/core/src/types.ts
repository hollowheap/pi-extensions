export type Tag = "edit" | "read" | "search" | "shell";
export type Effect = "allow" | "ask" | "deny";
export type Verdict = Effect;

export interface Rule {
  tag: Tag;
  pattern: string;
  effect: Effect;
}

export interface ModeNotice {
  text: string;
  level: "info" | "warning" | "error";
}

export interface ModeEnter {
  veto?: string;
  notice?: ModeNotice;
}

export type ModeSource = "builtin" | "package" | "config";

export interface ModeLayer {
  name: string;
  description?: string;
  defaults: Record<Tag, Effect>;
  overrides?: readonly Rule[];
  onEnter?: (owner: unknown) => ModeEnter | undefined;
  source?: ModeSource;
}
