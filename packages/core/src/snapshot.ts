export interface ModeSnapshot {
  name: string;
  updatedAt: number;
}

export interface CwdSnapshot {
  root?: string;
  effective: string;
  updatedAt: number;
}

export interface AgentSnapshot {
  name: string | null;
  description?: string;
  model?: string;
  thinking?: string;
  mode?: string;
  tools?: string[];
  skills?: string[];
  updatedAt: number;
}

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  budgetCap?: number;
  budgetWarning?: boolean;
  byModel?: Record<string, { tokens: number; cost: number }>;
  updatedAt: number;
}

export interface TodoSnapshotItem {
  id: number;
  text: string;
  done: boolean;
  priority?: "high" | "medium" | "low";
}

export interface TodosSnapshot {
  total: number;
  open: number;
  done: number;
  highPriority: number;
  items: TodoSnapshotItem[];
  updatedAt: number;
}

export interface TaskSnapshotItem {
  id: string;
  status: string;
  command?: string;
  startedAt?: number;
  exitCode?: number | null;
}

export interface TasksSnapshot {
  running: number;
  total: number;
  recent: TaskSnapshotItem[];
  updatedAt: number;
}

export interface SubagentSnapshotItem {
  id: string;
  agent: string;
  status: string;
  task?: string;
  activeTool?: string;
}

export interface SubagentsSnapshot {
  running: number;
  total: number;
  sessionDefinitions: string[];
  items: SubagentSnapshotItem[];
  updatedAt: number;
}

export interface MemorySnapshot {
  observations: number;
  reflections: number;
  unconsumed: number;
  latestObservation?: string;
  updatedAt: number;
}

export interface GuardSnapshot {
  trusted: boolean;
  decisionCount: number;
  activeGrantCount: number;
  approvedTagsCount: number;
  deniedCount: number;
  updatedAt: number;
}

export interface HooksSnapshot {
  sessionStartCount: number;
  preToolCount: number;
  postToolCount: number;
  runs: number;
  blocks: number;
  errors: number;
  updatedAt: number;
}

export interface LspServerSnapshot {
  name: string;
  language?: string;
  status: string;
}

export interface LspSnapshot {
  servers: LspServerSnapshot[];
  requestCount: number;
  updatedAt: number;
}

export interface WebSnapshot {
  searchCount: number;
  fetchCount: number;
  recentUrls: string[];
  updatedAt: number;
}

export interface QuestionsSnapshot {
  askedCount: number;
  lastQuestion?: string;
  lastAnswer?: string;
  updatedAt: number;
}

export interface DecideSnapshot {
  totalCount: number;
  cacheHits: number;
  lastKind?: string;
  updatedAt: number;
}

export interface ModalSnapshot {
  vimMode?: string;
  toolsExpanded?: boolean;
  lastTool?: string;
  hasLastCodemode?: boolean;
  updatedAt: number;
}

export interface SessionSnapshot {
  mode?: ModeSnapshot;
  cwd?: CwdSnapshot;
  agent?: AgentSnapshot;
  usage?: UsageSnapshot;
  todos?: TodosSnapshot;
  tasks?: TasksSnapshot;
  subagents?: SubagentsSnapshot;
  memory?: MemorySnapshot;
  guard?: GuardSnapshot;
  hooks?: HooksSnapshot;
  lsp?: LspSnapshot;
  web?: WebSnapshot;
  questions?: QuestionsSnapshot;
  decide?: DecideSnapshot;
  modal?: ModalSnapshot;
}

export type SnapshotListener = (snapshot: SessionSnapshot) => void;

interface SnapshotStore {
  snapshots: Map<unknown, SessionSnapshot>;
  listeners: Map<unknown, Set<SnapshotListener>>;
}

const SNAPSHOT_KEY = Symbol.for("@hollowheap/core/snapshot");

function getStore(): SnapshotStore {
  const globalStore = globalThis as unknown as Record<
    symbol,
    SnapshotStore | undefined
  >;
  const existing = globalStore[SNAPSHOT_KEY];
  if (existing !== undefined) return existing;
  const created: SnapshotStore = {
    snapshots: new Map(),
    listeners: new Map(),
  };
  globalStore[SNAPSHOT_KEY] = created;
  return created;
}

function validOwner(owner: unknown): boolean {
  return owner !== undefined && owner !== null;
}

function notifyListeners(owner: unknown, snapshot: SessionSnapshot): void {
  const listeners = getStore().listeners.get(owner);
  if (listeners === undefined || listeners.size === 0) return;
  const copy = { ...snapshot };
  for (const listener of [...listeners]) {
    try {
      listener(copy);
    } catch {
      // Snapshot listeners must not break state writers.
    }
  }
}

export function getSessionSnapshot(owner: unknown): SessionSnapshot {
  if (!validOwner(owner)) return {};
  const existing = getStore().snapshots.get(owner);
  return existing === undefined ? {} : { ...existing };
}

export function updateSessionSnapshot<K extends keyof SessionSnapshot>(
  owner: unknown,
  key: K,
  value: SessionSnapshot[K],
): void {
  if (!validOwner(owner)) return;
  const store = getStore();
  const current = store.snapshots.get(owner) ?? {};
  const next: SessionSnapshot = { ...current };
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  store.snapshots.set(owner, next);
  notifyListeners(owner, next);
}

export function patchSessionSnapshot(
  owner: unknown,
  patch: Partial<SessionSnapshot>,
): void {
  if (!validOwner(owner)) return;
  const store = getStore();
  const current = store.snapshots.get(owner) ?? {};
  const next: SessionSnapshot = { ...current };
  for (const [key, value] of Object.entries(patch) as Array<
    [keyof SessionSnapshot, SessionSnapshot[keyof SessionSnapshot]]
  >) {
    if (value === undefined) {
      delete next[key];
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  store.snapshots.set(owner, next);
  notifyListeners(owner, next);
}

export function dropSessionSnapshot(owner: unknown): void {
  if (!validOwner(owner)) return;
  const store = getStore();
  store.snapshots.delete(owner);
  store.listeners.delete(owner);
}

export function subscribeSessionSnapshot(
  owner: unknown,
  listener: SnapshotListener,
): () => void {
  if (!validOwner(owner)) return () => undefined;
  const store = getStore();
  let set = store.listeners.get(owner);
  if (set === undefined) {
    set = new Set();
    store.listeners.set(owner, set);
  }
  set.add(listener);
  return () => {
    const active = store.listeners.get(owner);
    if (active === undefined) return;
    active.delete(listener);
    if (active.size === 0) store.listeners.delete(owner);
  };
}

export interface PersistedSessionSummary {
  mode?: string;
  cwd?: string | null;
  agent?: string | null;
  totalTokens?: number;
  totalCost?: number;
  budgetCap?: number;
  todosOpen?: number;
  todosTotal?: number;
  observations?: number;
  questionsAsked?: number;
  taskRuns?: number;
  subagentRuns?: number;
  webLinks?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract compact metadata from a session's branch entries without loading extensions. */
export function extractSessionSummaryFromEntries(
  entries: readonly unknown[],
): PersistedSessionSummary {
  if (!Array.isArray(entries)) return {};
  const summary: PersistedSessionSummary = {};
  const observationIds = new Set<string>();
  const taskIds = new Set<string>();
  const subagentIds = new Set<string>();
  let questionsAsked = 0;
  let webLinks = 0;

  for (const raw of entries) {
    if (!isRecord(raw)) continue;
    const customType =
      raw.type === "custom"
        ? raw.customType
        : typeof raw.customType === "string"
          ? raw.customType
          : raw.type;
    const data = raw.data;
    if (typeof customType !== "string" || !isRecord(data)) continue;

    if (
      customType === "hollowheap.core.mode" &&
      typeof data.mode === "string"
    ) {
      summary.mode = data.mode;
    } else if (customType === "hollowheap.core.cwd") {
      if (typeof data.cwd === "string" || data.cwd === null) {
        summary.cwd = data.cwd;
      }
    } else if (customType === "hollowheap.agent") {
      if (typeof data.name === "string" || data.name === null) {
        summary.agent = data.name;
      }
    } else if (customType === "hollowheap.usage") {
      if (
        typeof data.inputTokens === "number" &&
        typeof data.outputTokens === "number" &&
        typeof data.totalCost === "number"
      ) {
        const cacheRead =
          typeof data.cacheReadTokens === "number" ? data.cacheReadTokens : 0;
        const cacheWrite =
          typeof data.cacheWriteTokens === "number" ? data.cacheWriteTokens : 0;
        summary.totalTokens =
          data.inputTokens + data.outputTokens + cacheRead + cacheWrite;
        summary.totalCost = data.totalCost;
        if (typeof data.budgetCap === "number" && data.budgetCap > 0) {
          summary.budgetCap = data.budgetCap;
        } else {
          Reflect.deleteProperty(summary, "budgetCap");
        }
      }
    } else if (customType === "hollowheap.todos" && Array.isArray(data.todos)) {
      let open = 0;
      let total = 0;
      for (const item of data.todos) {
        if (!isRecord(item)) continue;
        total += 1;
        if (item.done !== true) open += 1;
      }
      summary.todosOpen = open;
      summary.todosTotal = total;
    } else if (
      customType === "hollowheap.memory.observation" &&
      typeof data.id === "string"
    ) {
      observationIds.add(data.id);
    } else if (customType === "hollowheap.memory.clear") {
      observationIds.clear();
    } else if (customType === "hollowheap.question.answers") {
      questionsAsked += 1;
    } else if (customType === "hollowheap.web.history") {
      if (Array.isArray(data.urls)) webLinks = data.urls.length;
    } else if (
      customType === "hollowheap.tasks.run" &&
      typeof data.id === "string"
    ) {
      taskIds.add(data.id);
    } else if (
      customType === "hollowheap.subagents.run" &&
      typeof data.id === "string"
    ) {
      subagentIds.add(data.id);
    }
  }

  if (observationIds.size > 0) summary.observations = observationIds.size;
  if (questionsAsked > 0) summary.questionsAsked = questionsAsked;
  if (taskIds.size > 0) summary.taskRuns = taskIds.size;
  if (subagentIds.size > 0) summary.subagentRuns = subagentIds.size;
  if (webLinks > 0) summary.webLinks = webLinks;
  return summary;
}
