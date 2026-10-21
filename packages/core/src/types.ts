export type Tag = "edit" | "read" | "search" | "shell";
export type Effect = "allow" | "deny";
export type Verdict = "allow" | "deny" | "ask";

export interface Rule {
  tag: Tag;
  pattern: string;
  effect: Effect;
}

export interface ModeApplyDetails {
  inPlanPaths: boolean;
}

export interface ModeNotice {
  text: string;
  level: "info" | "warning" | "error";
}

export interface ModeEnter {
  veto?: string;
  notice?: ModeNotice;
}

export interface ModeDefinition {
  name: string;
  apply: (tag: Tag, verdict: Verdict, details: ModeApplyDetails) => Verdict;
  onEnter?: (owner: unknown) => ModeEnter | undefined;
}

export interface ModesQuery {
  modes: ModeDefinition[];
}

export interface ModeEnterQuery {
  mode: string;
  owner: unknown;
  veto?: string;
  notice?: ModeNotice;
}

export interface CwdSetCommand {
  owner: unknown;
  dir: string | undefined;
}

export interface CwdQuery {
  owner: unknown;
  dir?: string;
}
