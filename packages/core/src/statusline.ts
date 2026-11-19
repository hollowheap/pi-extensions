import { sanitizeTerminalText } from "./format.js";

export interface StatuslineTokenTotals {
  input: number;
  output: number;
  cost: number;
}

export interface StatuslineGitDiffSummary {
  added: number;
  modified: number;
  removed: number;
  untracked: number;
}

export interface StatuslineContext {
  cwd: string;
  homeDir: string;
  repoRoot?: string | null;
  modelId?: string;
  branch: string | null;
  tokens: StatuslineTokenTotals;
  contextPercent: number | null;
  budgetPercent?: number;
  busy: boolean;
  now: Date;
  gitDiff?: StatuslineGitDiffSummary;
  thinkingLevel?: string;
}

export interface StatuslineComponentSpec {
  type: string;
  [option: string]: unknown;
}

export interface StatuslineProvider {
  name: string;
  render(spec: StatuslineComponentSpec, ctx: StatuslineContext): string;
  refresh?(
    spec: StatuslineComponentSpec,
    ctx: StatuslineContext,
  ): void | Promise<void>;
  intervalMs?(spec: StatuslineComponentSpec): number | undefined;
}

const PROVIDERS_KEY = Symbol.for("@hollowheap/core/statusline-providers");

function providerMap(): Map<string, StatuslineProvider> {
  const store = globalThis as unknown as Record<
    symbol,
    Map<string, StatuslineProvider> | undefined
  >;
  const existing = store[PROVIDERS_KEY];
  if (existing !== undefined) return existing;
  const created = new Map<string, StatuslineProvider>();
  store[PROVIDERS_KEY] = created;
  return created;
}

export function registerStatuslineProvider(
  provider: StatuslineProvider,
): () => void {
  const providers = providerMap();
  providers.set(provider.name, provider);
  return () => {
    if (providers.get(provider.name) === provider) {
      providers.delete(provider.name);
    }
  };
}

export function getStatuslineProvider(
  name: string,
): StatuslineProvider | undefined {
  return providerMap().get(name);
}

export function listStatuslineProviders(): string[] {
  return [...providerMap().keys()];
}

interface StatuslineEventState {
  values: Map<string, string>;
  providers: Map<string, StatuslineProvider>;
}

const EVENT_VALUES_KEY = Symbol.for("@hollowheap/core/statusline-event-values");

function eventState(): StatuslineEventState {
  const store = globalThis as unknown as Record<
    symbol,
    StatuslineEventState | undefined
  >;
  const existing = store[EVENT_VALUES_KEY];
  if (existing !== undefined) return existing;
  const created: StatuslineEventState = {
    values: new Map(),
    providers: new Map(),
  };
  store[EVENT_VALUES_KEY] = created;
  return created;
}

export function setStatuslineEventValue(name: string, text: string): void {
  const state = eventState();
  state.values.set(name, text);
  if (providerMap().has(name)) return;
  let provider = state.providers.get(name);
  if (provider === undefined) {
    provider = {
      name,
      render: () => state.values.get(name) ?? "",
    };
    state.providers.set(name, provider);
    providerMap().set(name, provider);
  }
}

export function statuslineEventValues(): ReadonlyMap<string, string> {
  return eventState().values;
}

export function clearStatuslineEventValues(): void {
  const state = eventState();
  const providers = providerMap();
  for (const [name, provider] of state.providers) {
    if (providers.get(name) === provider) providers.delete(name);
  }
  state.providers.clear();
  state.values.clear();
}

export interface StatuslineExecResult {
  stdout: string;
  stderr?: string;
  code: number;
}

export type StatuslineExecutor = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number },
) => Promise<StatuslineExecResult>;

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function stringArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item !== "",
  );
}

export function createScriptStatuslineProvider(
  executor: StatuslineExecutor,
  name = "script",
): StatuslineProvider {
  const cache = new Map<string, string>();

  function keyFor(
    spec: StatuslineComponentSpec,
    ctx: StatuslineContext,
  ): string {
    const cwd =
      typeof spec.cwd === "string" && spec.cwd !== "" ? spec.cwd : ctx.cwd;
    return JSON.stringify([spec.command, spec.args, cwd]);
  }

  return {
    name,
    render(spec, ctx) {
      return cache.get(keyFor(spec, ctx)) ?? "";
    },
    async refresh(spec, ctx) {
      const key = keyFor(spec, ctx);
      const command =
        typeof spec.command === "string" ? spec.command.trim() : "";
      if (command === "") {
        cache.delete(key);
        return;
      }
      const [executable, ...commandArgs] = command.split(/\s+/);
      const cwd =
        typeof spec.cwd === "string" && spec.cwd !== "" ? spec.cwd : ctx.cwd;
      const timeoutMs = boundedNumber(spec.timeoutMs, 1000, 100, 10_000);
      const maxChars = boundedNumber(spec.maxChars, 160, 1, 2000);
      let output = "";
      try {
        const result = await executor(
          executable ?? "",
          [...commandArgs, ...stringArgs(spec.args)],
          { cwd, timeoutMs },
        );
        if (result.code === 0) output = result.stdout;
      } catch {
        output = "";
      }
      const firstLine = output.split(/\r?\n/, 1)[0] ?? "";
      cache.set(
        key,
        sanitizeTerminalText(firstLine.trim(), { allowSgr: false }).slice(
          0,
          maxChars,
        ),
      );
    },
    intervalMs(spec) {
      return boundedNumber(spec.intervalMs, 15_000, 250, 60_000);
    },
  };
}

export interface StatuslineEventEmitter {
  on?: (channel: string, handler: (data: unknown) => void) => unknown;
  off?: (channel: string, handler: (data: unknown) => void) => unknown;
  emit?: (channel: string, data: unknown) => unknown;
}

export interface StatuslinePublisher {
  publish: (text?: string) => void;
  dispose: () => void;
}

export function createStatuslinePublisher(
  events: StatuslineEventEmitter | undefined,
  name: string,
  getText: () => string,
): StatuslinePublisher {
  const publish = (text = getText()): void => {
    events?.emit?.("statusline:values", { name, text });
  };
  const handler = (data: unknown): void => {
    if (typeof data === "object" && data !== null) {
      const names = (data as { names?: unknown }).names;
      if (Array.isArray(names) && !names.includes(name)) return;
    }
    publish();
  };
  const unsubscribe = events?.on?.("statusline:request", handler);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (typeof unsubscribe === "function") {
      unsubscribe();
    } else {
      events?.off?.("statusline:request", handler);
    }
  };
  return { publish, dispose };
}
