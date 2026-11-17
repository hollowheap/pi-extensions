import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { registerMode } from "@hollowheap/core/modes";
import type { AgentConfig } from "./agents.js";
import type { SubagentState } from "./state.js";
import { createSubagentTool } from "./tool.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

const mocks = vi.hoisted(() => ({
  getAgentDir: vi.fn(),
  listSubagents: vi.fn(),
  readSubagentLog: vi.fn(),
  discoverAgents: vi.fn(),
  loadSubagentsConfig: vi.fn(),
  startSubagent: vi.fn(),
  sendSubagent: vi.fn(),
  attachSubagent: vi.fn(),
  abortSubagent: vi.fn(),
  waitSubagent: vi.fn(),
  generateSubagentId: vi.fn(),
  resolveSubagentModel: vi.fn(),
}));

vi.mock("./runner.js", () => ({
  startSubagent: mocks.startSubagent,
  attachSubagent: mocks.attachSubagent,
  sendSubagent: mocks.sendSubagent,
  abortSubagent: mocks.abortSubagent,
  waitSubagent: mocks.waitSubagent,
  listSubagents: mocks.listSubagents,
  readSubagentLog: mocks.readSubagentLog,
  generateSubagentId: mocks.generateSubagentId,
}));
vi.mock("./agents.js", () => ({ discoverAgents: mocks.discoverAgents }));
vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return { ...actual, loadSubagentsConfig: mocks.loadSubagentsConfig };
});
vi.mock("./swap.js", () => ({ resolveSubagentModel: mocks.resolveSubagentModel }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, getAgentDir: mocks.getAgentDir };
});

const agent: AgentConfig = {
  name: "scout",
  description: "Fast recon",
  systemPrompt: "You are a scout.",
  source: "user",
  filePath: "/tmp/scout.md",
};
const running: SubagentState = {
  id: "sub-1",
  status: "running",
  agent: "scout",
  task: "find",
  depth: 1,
  attempt: 1,
  project: "/repo",
  startedAt: 1,
  socket: "/tmp/sub.sock",
};
const ctx = {
  cwd: "/repo",
  sessionManager: { getSessionId: () => "session-1" },
  isProjectTrusted: () => true,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAgentDir.mockReturnValue("/tmp/s101");
  mocks.listSubagents.mockResolvedValue([]);
  mocks.readSubagentLog.mockReturnValue("");
  mocks.discoverAgents.mockReturnValue({ agents: [agent] });
  mocks.loadSubagentsConfig.mockReturnValue({
    maxConcurrent: 4,
    maxDepth: 1,
    defaultTimeoutMs: 1_800_000,
    writeLockTimeoutMs: 30_000,
    maxSessionAgents: 32,
    maxSessionAgentBytes: 65_536,
    harnesses: {},
    path: "/tmp/subagents.json",
    diagnostics: [],
  });
  mocks.startSubagent.mockResolvedValue(running);
  mocks.sendSubagent.mockResolvedValue(undefined);
  mocks.attachSubagent.mockResolvedValue(running);
  mocks.resolveSubagentModel.mockResolvedValue(undefined);
});

afterEach(() => {
  Reflect.deleteProperty(process.env, "PI_SUBAGENT_DEPTH");
});

describe("S101 explicit resume", () => {
  it("resumes a failed child with the same id, session, and incremented attempt", async () => {
    mocks.attachSubagent.mockResolvedValue({
      ...running,
      pid: 999_999_999,
      status: "failed",
      attempt: 1,
      parentSession: "session-1",
      session: "/tmp/sub-1.session.jsonl",
    });
    const tool = createSubagentTool();
    await tool.execute(
      "1",
      { action: "resume", id: "sub-1" },
      undefined,
      undefined,
      ctx as never,
    );

    expect(mocks.startSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub-1",
        attempt: 2,
        parentSession: "session-1",
        sessionPath: "/tmp/sub-1.session.jsonl",
      }),
    );

    mocks.attachSubagent.mockResolvedValue(running);
    const notFailed = await createSubagentTool().execute(
      "1",
      { action: "resume", id: "sub-1" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(JSON.stringify(notFailed)).toContain("only failed");
  });
});
