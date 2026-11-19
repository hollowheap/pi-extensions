import { registerMode } from "@hollowheap/core/modes";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../src/agents.js";
import type { SubagentState } from "../src/state.js";
import { createSubagentTool } from "../src/tool.js";

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

vi.mock("../src/runner.js", () => ({
  startSubagent: mocks.startSubagent,
  attachSubagent: mocks.attachSubagent,
  sendSubagent: mocks.sendSubagent,
  abortSubagent: mocks.abortSubagent,
  waitSubagent: mocks.waitSubagent,
  listSubagents: mocks.listSubagents,
  readSubagentLog: mocks.readSubagentLog,
  generateSubagentId: mocks.generateSubagentId,
}));
vi.mock("../src/agents.js", () => ({ discoverAgents: mocks.discoverAgents }));
vi.mock("../src/settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/settings.js")>();
  return { ...actual, loadSubagentsConfig: mocks.loadSubagentsConfig };
});
vi.mock("../src/swap.js", () => ({
  resolveSubagentModel: mocks.resolveSubagentModel,
}));
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

describe("explicit resume", () => {
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

  it("resume is denied when the project is not trusted", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "1",
      { action: "resume", id: "sub-1" },
      undefined,
      undefined,
      { ...ctx, isProjectTrusted: () => false } as never,
    );
    expect(JSON.stringify(result)).toContain(
      "resume requires a trusted project",
    );
    expect(mocks.startSubagent).not.toHaveBeenCalled();
  });

  it("resume of an unknown id is reported without starting a child", async () => {
    mocks.attachSubagent.mockResolvedValue(undefined);
    const result = await createSubagentTool().execute(
      "1",
      { action: "resume", id: "sub-9" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(JSON.stringify(result)).toContain("unknown id: sub-9");
    expect(mocks.startSubagent).not.toHaveBeenCalled();
  });

  it("a successful resume notifies the owner through onSubagentsChange", async () => {
    mocks.attachSubagent.mockResolvedValue({
      ...running,
      pid: 999_999_999,
      status: "failed",
      attempt: 1,
      session: "/tmp/sub-1.session.jsonl",
    });
    const onSubagentsChange = vi.fn();
    const tool = createSubagentTool({ onSubagentsChange });
    await tool.execute(
      "1",
      { action: "resume", id: "sub-1" },
      undefined,
      undefined,
      ctx as never,
    );
    expect(onSubagentsChange).toHaveBeenCalledTimes(1);
  });
});
