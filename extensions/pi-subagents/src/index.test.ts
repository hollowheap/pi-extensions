import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension, {
  ACTIVE_AGENT_TYPE,
  createSubagentsExtension,
} from "./index.js";

function writeAgent(
  dir: string,
  name: string,
  frontmatter: string,
  body = "Agent system prompt",
) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\n${frontmatter}\n---\n${body}\n`);
}

type MockHandler = (...args: unknown[]) => unknown;
type MockCommand = {
  description: string;
  getArgumentCompletions: (
    prefix: string,
  ) => Array<{ value: string; label: string; description?: string }>;
  handler: (args: string, ctx: unknown) => Promise<void>;
};

function createMockPi() {
  const handlers = new Map<string, MockHandler[]>();
  const commands = new Map<string, MockCommand>();

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
    registerTool: vi.fn(),
    registerCommand: vi.fn((name: string, def: MockCommand) => {
      commands.set(name, def);
    }),
    registerShortcut: vi.fn(),
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
    getCommand: (name: string): MockCommand => {
      const cmd = commands.get(name);
      if (!cmd) throw new Error(`Command "${name}" not registered`);
      return cmd;
    },
  };
}

function createMockContext(overrides: Record<string, unknown> = {}) {
  const branch: Array<{ type: string; customType?: string; data?: unknown }> =
    [];
  return {
    cwd: "/mock-cwd",
    hasUI: true,
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
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      select: vi.fn(),
    },
    ...overrides,
  };
}

let testDir: string;
let agentsDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "pi-subagents-ext-"));
  agentsDir = join(testDir, "agents");
  writeAgent(
    agentsDir,
    "scout",
    "name: scout\ndescription: Read-only scout\nmodel: opencode-go/beam-free\nmode: plan\neffort: low\ntools: read, grep",
    "Scout persona instructions",
  );
  writeAgent(
    agentsDir,
    "architect",
    "name: architect\ndescription: System architect\nmodel: opencode-go/deepseek-v4.1-flash\nmode: ask\neffort: high",
    "Architect persona instructions",
  );
});

afterEach(() => {
  Reflect.deleteProperty(process.env, "PI_ACP");
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

describe("pi-subagents extension", () => {
  it("registers subagent tool, /agent command, and lifecycle hooks", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0] as {
      name: string;
      exposure: string;
    };
    expect(tool.name).toBe("subagent");
    expect(tool.exposure).toBe("direct");
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

  it("registers nothing under ACP", () => {
    process.env.PI_ACP = "1";
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.registerCommand).not.toHaveBeenCalled();
  });

  it("provides argument completions for discovered agents and default", () => {
    const pi = createMockPi();
    const ext = createSubagentsExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const cmd = pi.getCommand("agent");
    expect(cmd).toBeDefined();
    const completions = cmd?.getArgumentCompletions("") ?? [];
    const values = completions.map((c) => c.value);
    expect(values).toContain("default");
    expect(values).toContain("scout");
    expect(values).toContain("architect");

    const filtered = cmd?.getArgumentCompletions("sc") ?? [];
    expect(filtered.map((c) => c.value)).toEqual(["scout"]);
  });

  it("switches active agent by name via /agent <name>", async () => {
    const pi = createMockPi();
    const ext = createSubagentsExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext();
    const cmd = pi.getCommand("agent");

    await cmd.handler("scout", ctx);

    expect(pi.appendEntry).toHaveBeenCalledWith(ACTIVE_AGENT_TYPE, {
      name: "scout",
    });
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "scout");
    expect(pi.setModel).toHaveBeenCalledWith({
      provider: "opencode-go",
      id: "beam-free",
    });
    expect(pi.setThinkingLevel).toHaveBeenCalledWith("low");
    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "grep"]);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      'Switched to agent "scout"',
      "info",
    );

    // Verify before_agent_start persona injection
    const event = {
      systemPromptOptions: {
        sections: {} as Record<string, string>,
      },
    };
    pi.emit("before_agent_start", event);
    expect(event.systemPromptOptions.sections.agent_persona).toBe(
      "Scout persona instructions",
    );
  });

  it("notifies error for unknown agent name", async () => {
    const pi = createMockPi();
    const ext = createSubagentsExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext();
    const cmd = pi.getCommand("agent");

    await cmd.handler("nonexistent", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining('Unknown agent "nonexistent"'),
      "error",
    );
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it("resets to default persona via /agent default", async () => {
    const pi = createMockPi();
    const ext = createSubagentsExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext();
    const cmd = pi.getCommand("agent");

    // Switch to scout first
    await cmd.handler("scout", ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "scout");

    // Reset to default
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
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Reset to default agent persona",
      "info",
    );

    // Verify persona is removed in before_agent_start
    const event = {
      systemPromptOptions: {
        sections: { agent_persona: "existing" },
      },
    };
    pi.emit("before_agent_start", event);
    expect(event.systemPromptOptions.sections.agent_persona).toBeUndefined();
  });

  it("prompts with ctx.ui.select when /agent is invoked with no args", async () => {
    const pi = createMockPi();
    const ext = createSubagentsExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext();
    ctx.ui.select.mockImplementation(
      async (_title: string, options: string[]) => {
        return options.find((opt: string) => opt.startsWith("architect"));
      },
    );

    const cmd = pi.getCommand("agent");
    await cmd.handler("", ctx);

    expect(ctx.ui.select).toHaveBeenCalledWith(
      "Select an agent persona:",
      expect.arrayContaining([
        expect.stringContaining("(default)"),
        expect.stringContaining("scout"),
        expect.stringContaining("architect"),
      ]),
    );
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "architect");
    expect(pi.setThinkingLevel).toHaveBeenCalledWith("high");
  });

  it("restores active agent from session branch on session_start", async () => {
    const pi = createMockPi();
    const ext = createSubagentsExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext();
    ctx.branch.push({
      type: "custom",
      customType: ACTIVE_AGENT_TYPE,
      data: { name: "scout" },
    });

    await Promise.all(pi.emit("session_start", {}, ctx));

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "scout");
    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "grep"]);

    const event = {
      systemPromptOptions: {
        sections: {} as Record<string, string>,
      },
    };
    pi.emit("before_agent_start", event);
    expect(event.systemPromptOptions.sections.agent_persona).toBe(
      "Scout persona instructions",
    );
  });

  it("handles non-UI fallback by listing available agents", async () => {
    const pi = createMockPi();
    const ext = createSubagentsExtension({ getAgentDir: () => testDir });
    ext(pi as never);

    const ctx = createMockContext({ hasUI: false });
    const cmd = pi.getCommand("agent");

    await cmd.handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Available agents: default, architect, scout"),
      "info",
    );
  });
});
