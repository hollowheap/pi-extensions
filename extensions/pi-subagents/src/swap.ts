import type { AgentConfig } from "./agents.js";

export interface ModelInfo {
  provider: string;
  id: string;
}

export interface ModelResolutionContext {
  model?: ModelInfo | string;
  modelRegistry?: {
    getAvailable?: () => Promise<Array<unknown>> | Array<unknown>;
    getAll?: () => Array<unknown>;
  };
  hasUI?: boolean;
  ui?: {
    select?: (title: string, options: string[]) => Promise<string | undefined>;
  };
}

export interface ResolveModelDeps {
  getAvailableModels?: (
    ctx: ModelResolutionContext,
  ) => Promise<string[]> | string[];
  select?: (title: string, options: string[]) => Promise<string | undefined>;
}

export function formatModelId(model: unknown): string {
  if (typeof model === "string") return model.trim();
  if (typeof model === "object" && model !== null) {
    const raw = model as { provider?: unknown; id?: unknown };
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const provider =
      typeof raw.provider === "string" ? raw.provider.trim() : "";

    if (!id) return "";
    if (!provider) return id;
    if (id.startsWith(`${provider}/`)) return id;
    return `${provider}/${id}`;
  }
  return "";
}

export async function getRuntimeModels(
  ctx: ModelResolutionContext,
): Promise<string[]> {
  const models = new Set<string>();

  const sessionModel = formatModelId(ctx.model);
  if (sessionModel) {
    models.add(sessionModel);
  }

  if (ctx.modelRegistry) {
    if (typeof ctx.modelRegistry.getAvailable === "function") {
      try {
        const available = await ctx.modelRegistry.getAvailable();
        if (Array.isArray(available)) {
          for (const item of available) {
            const formatted = formatModelId(item);
            if (formatted) models.add(formatted);
          }
        }
      } catch {
        // Ignore registry query errors; fallback to session model
      }
    }
    if (models.size <= 1 && typeof ctx.modelRegistry.getAll === "function") {
      try {
        const all = ctx.modelRegistry.getAll();
        if (Array.isArray(all)) {
          for (const item of all) {
            const formatted = formatModelId(item);
            if (formatted) models.add(formatted);
          }
        }
      } catch {
        // Ignore registry query errors
      }
    }
  }

  return Array.from(models);
}

export function isModelAvailable(
  requested: string,
  availableModels: string[],
): boolean {
  if (availableModels.length === 0) {
    return true;
  }
  const cleanRequested = requested.trim().toLowerCase();
  for (const m of availableModels) {
    const cleanAvailable = m.trim().toLowerCase();
    if (cleanAvailable === cleanRequested) return true;
    if (cleanAvailable.endsWith(`/${cleanRequested}`)) return true;
    if (cleanRequested.endsWith(`/${cleanAvailable}`)) return true;
  }
  return false;
}

export async function resolveSubagentModel(
  agent: AgentConfig,
  ctx: ModelResolutionContext,
  deps: ResolveModelDeps = {},
): Promise<string | undefined> {
  const requestedModel = agent.model?.trim();
  if (!requestedModel) {
    return undefined;
  }

  const sessionModel = formatModelId(ctx.model);
  const available = deps.getAvailableModels
    ? await deps.getAvailableModels(ctx)
    : await getRuntimeModels(ctx);

  if (isModelAvailable(requestedModel, available)) {
    return requestedModel;
  }

  const selectFn = deps.select ?? ctx.ui?.select?.bind(ctx.ui);
  const hasUI = ctx.hasUI !== false && typeof selectFn === "function";

  const options =
    available.length > 0 ? available : sessionModel ? [sessionModel] : [];

  if (hasUI && selectFn && options.length > 0) {
    const choice = await selectFn(
      `Subagent "${agent.name}" requests model "${requestedModel}" which is unavailable. Select replacement:`,
      options,
    );
    if (choice) {
      return choice;
    }
  }

  // Interactive cancel or headless fallback to active session model
  return sessionModel || requestedModel;
}
