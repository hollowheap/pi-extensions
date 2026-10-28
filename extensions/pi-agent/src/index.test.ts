import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension, { ACTIVE_AGENT_TYPE, createAgentExtension } from "./index.js";

type MockHandler = (...args: unknown[]) => unknown;
type MockCommand = {
  description: string;
  getArgumentCompletions: (
    prefix: string,
  ) => Array<{ value: string; label: string; description?: string }>;
  handler: (args: string, ctx: unknown) => Promise<void>;
};

function writeAgent(
  dir: string,
  name: string,
  frontmatter: string,
  body = "Agent instructions",
) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\n${frontmatter}\n---\n${body}\n`);
}

function createMockPi() {
  const handlers = new Map<string, MockHandler[]>();
  const commands = new Map<string, MockCommand>();
  let currentSessionName: string | undefined = "session-1";

  return {
    on: vi.fn((event: string, handler: MockHandler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    emit: (event: string, ...args: unknown[]) => {
      const list = handlers.get(event) ?? [];
      return list.map((h) => h(...args));
    },
    registerCommand: vi.fn((name: string, def: MockCommand) => {
      commands.set(name, def);
    }),
    appendEntry: vi.fn(),
    setActiveTools: vi.fn(),
    getAllTools: vi.fn(() => [
      { name: "read" },
      { name: "edit" },
      { name: "bash" },
      { name: "grep" },
    ]),
    setModel: vi.fn().mockResolvedValue(true),
    setThinkingLevel: vi.fn(),
    setSessionName: vi.fn((name: string) => {
      currentSessionName = name;
    }),
    getSessionName: vi.fn(() => currentSessionName),
    setLabel: vi.fn(),
    getCommand: (name: string): MockCommand => {
      const cmd = commands.get(name);
      if (!cmd) throw new Error(`Command "${name}" not registered`);
      return cmd;
    },
  };
}

function createMockContext(overrides: Record<string, unknown> = {}) {
  const branch: Array<{
    id: string;
    type: string;
    customType?: string;
    data?: unknown;
    message?: { role?: string; content?: unknown };
  }> = [];

  const ui = {
    notify: vi.fn(),
    setStatus: vi.fn(),
    select: vi.fn(),
    confirm: vi.fn(),
    custom: vi.fn().mockResolvedValue(undefined),
  };

  return {
    cwd: "/mock-cwd",
    hasUI: true,
    mode: "tui",
    isProjectTrusted: vi.fn(() => true),
    sessionManager: {
      getBranch: vi.fn(() => branch),
    },
    branch,
    modelRegistry: {
      getAll: vi.fn(() => [
        { provider: "opencode-go", id: "beam-free" },
        { provider: "opencode-go", id: "deepseek-v4.1-flash" },
      ]),
    },
    fork: vi.fn().mockImplementation(async (_id, opts) => {
      if (opts?.withSession) {
        await opts.withSession(createMockContext({ branch, ui }));
      }
      return { cancelled: false };
    }),
    ui,
    ...overrides,
  };
}

let testDir: string;
let agentsDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "pi-agent-ext-"));
  agentsDir = join(testDir, "agents");
  writeAgent(
    agentsDir,
    "scout",
    "name: scout\ndescription: Recon\nmodel: opencode-go/beam-free\nmode: plan\neffort: low\ntools: read, grep\nskills: author-pr",
    "Scout persona instructions",
  );
  writeAgent(
    agentsDir,
    "engineer",
    "name: engineer\ndescription: Software engineer\nmodel: opencode-go/deepseek-v4.1-flash\nmode: ask\neffort: high",
    "Engineer persona instructions",
  );
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

describe("pi-agent extension", () => {
  it("registers /agent command and lifecycle hooks", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        description: expect.any(String),
        getArgumentCompletions: expect.any(Function),
        handler: expect.any(Function),
      }),
    );
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_tree", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith(
      "before_agent_start",
      expect.any(Function),
    );
  });

  it("provides argument completions for discovered agents and default", () => {
    const pi = createMockPi();
    const ext = createAgentExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const cmd = pi.getCommand("agent");
    const completions = cmd.getArgumentCompletions("");
    const values = completions.map((c) => c.value);
    expect(values).toContain("default");
    expect(values).toContain("scout");
    expect(values).toContain("engineer");

    const filtered = cmd.getArgumentCompletions("sc");
    expect(filtered.map((c) => c.value)).toEqual(["scout"]);
  });

  it("forks session and sets branch label when switching agent in active chat", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext();
    // Add history
    ctx.branch.push({
      id: "msg-1",
      type: "message",
      message: { role: "user", content: "hello" },
    });

    const cmd = pi.getCommand("agent");
    await cmd.handler("scout", ctx);

    expect(ctx.fork).toHaveBeenCalledWith(
      "msg-1",
      expect.objectContaining({ position: "at" }),
    );
    expect(pi.setLabel).toHaveBeenCalledWith("msg-1", "agent: scout");
    expect(pi.setSessionName).toHaveBeenCalledWith("[scout] session-1");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "scout");
    expect(pi.appendEntry).toHaveBeenCalledWith(ACTIVE_AGENT_TYPE, {
      name: "scout",
    });
    expect(pi.setModel).toHaveBeenCalledWith({
      provider: "opencode-go",
      id: "beam-free",
    });
    expect(pi.setThinkingLevel).toHaveBeenCalledWith("low");
    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "grep"]);
    expect(ctx.ui.custom).toHaveBeenCalled();
  });

  it("switches in-place without forking when session has no history", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext(); // empty branch
    const cmd = pi.getCommand("agent");
    await cmd.handler("engineer", ctx);

    expect(ctx.fork).not.toHaveBeenCalled();
    expect(pi.setSessionName).toHaveBeenCalledWith("[engineer] session-1");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "engineer");
    expect(pi.appendEntry).toHaveBeenCalledWith(ACTIVE_AGENT_TYPE, {
      name: "engineer",
    });
    expect(pi.setThinkingLevel).toHaveBeenCalledWith("high");
    expect(ctx.ui.custom).toHaveBeenCalled();
  });

  it("filters skills and injects agent instructions in before_agent_start", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext();
    const cmd = pi.getCommand("agent");
    await cmd.handler("scout", ctx);

    const event = {
      systemPromptOptions: {
        sections: {} as Record<string, string>,
        skills: [
          { name: "author-pr", filePath: "/skills/author-pr" },
          { name: "git-commit", filePath: "/skills/git-commit" },
          { name: "review", filePath: "/skills/review" },
        ],
      },
    };

    pi.emit("before_agent_start", event);

    expect(event.systemPromptOptions.sections.agent).toBe(
      "Scout persona instructions",
    );
    // Scout specifies skills: author-pr
    expect(event.systemPromptOptions.skills.map((s) => s.name)).toEqual([
      "author-pr",
    ]);
  });

  it("resets to default agent via /agent default", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext();
    const cmd = pi.getCommand("agent");

    await cmd.handler("scout", ctx);
    await cmd.handler("default", ctx);

    expect(pi.appendEntry).toHaveBeenCalledWith(ACTIVE_AGENT_TYPE, {
      name: undefined,
    });
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", undefined);
    expect(pi.setActiveTools).toHaveBeenCalledWith([
      "read",
      "edit",
      "bash",
      "grep",
    ]);

    const event = {
      systemPromptOptions: {
        sections: { agent: "existing" },
        skills: [{ name: "author-pr", filePath: "/p" }],
      },
    };
    pi.emit("before_agent_start", event);
    expect(event.systemPromptOptions.sections.agent).toBeUndefined();
    expect(event.systemPromptOptions.skills).toHaveLength(1);
  });

  it("restores active agent on session_start from custom entry", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext();
    ctx.branch.push({
      id: "custom-1",
      type: "custom",
      customType: ACTIVE_AGENT_TYPE,
      data: { name: "engineer" },
    });

    await Promise.all(pi.emit("session_start", {}, ctx));

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "engineer");

    const event = {
      systemPromptOptions: {
        sections: {} as Record<string, string>,
      },
    };
    pi.emit("before_agent_start", event);
    expect(event.systemPromptOptions.sections.agent).toBe(
      "Engineer persona instructions",
    );
  });

  it("does not overwrite session mode on session_start when no agent is active", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext();
    const enterModeSpy = vi.fn();
    (ctx.sessionManager as Record<string, unknown>).appendCustomEntry =
      enterModeSpy;

    await Promise.all(pi.emit("session_start", {}, ctx));
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", undefined);
    expect(enterModeSpy).not.toHaveBeenCalled();
  });
});
