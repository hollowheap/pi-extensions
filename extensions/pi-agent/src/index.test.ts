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
    getActiveTools: vi.fn(() => ["read", "edit", "bash", "grep"]),
    getAllTools: vi.fn(() => [
      { name: "read", exposure: "direct" },
      { name: "edit", exposure: "direct" },
      { name: "bash", exposure: "direct" },
      { name: "grep", exposure: "direct" },
      { name: "powershell", exposure: "direct" },
      { name: "web_search", exposure: "codemode" },
      { name: "codemode", exposure: "model-only" },
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
    setTitle: vi.fn(),
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

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
let testDir: string;
let agentsDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "pi-agent-ext-"));
  process.env.PI_CODING_AGENT_DIR = testDir;
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
  if (originalAgentDir === undefined) {
    Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
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
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "agents",
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
    const ext = createAgentExtension();
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

  it("hides project agents from completions while project trust is pending", async () => {
    const projectDir = join(testDir, "project");
    writeAgent(
      join(projectDir, ".pi", "agents"),
      "project-agent",
      "name: project-agent\ndescription: Project agent",
    );
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext({
      cwd: projectDir,
      isProjectTrusted: () => true,
    });
    await Promise.all(pi.emit("session_start", {}, ctx));

    const cmd = pi.getCommand("agent");
    expect(cmd.getArgumentCompletions("").map((c) => c.value)).toContain(
      "project-agent",
    );

    pi.emit("project_trust", { type: "project_trust", cwd: projectDir });

    expect(cmd.getArgumentCompletions("").map((c) => c.value)).not.toContain(
      "project-agent",
    );
  });

  it("forks session and sets branch label when switching agent in active chat", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);
    // The host loads a fresh extension instance for the forked session.
    const forkedPi = createMockPi();
    createAgentExtension()(forkedPi as never);

    const ctx = createMockContext();
    // Add history
    ctx.branch.push({
      id: "msg-1",
      type: "message",
      message: { role: "user", content: "hello" },
    });
    const forkCtx = createMockContext({ branch: ctx.branch });
    ctx.fork = vi.fn(async (_id, opts) => {
      for (const method of ["setSessionName", "setLabel", "appendEntry"]) {
        (pi as Record<string, unknown>)[method] = vi.fn(() => {
          throw new Error("This extension ctx is stale");
        });
      }
      await Promise.all(
        forkedPi.emit("session_start", { reason: "fork" }, forkCtx),
      );
      await opts?.withSession?.(forkCtx);
      return { cancelled: false };
    }) as never;

    const cmd = pi.getCommand("agent");
    await cmd.handler("scout", ctx);

    expect(ctx.fork).toHaveBeenCalledWith(
      "msg-1",
      expect.objectContaining({ position: "at" }),
    );
    expect(forkedPi.setLabel).toHaveBeenCalledWith("msg-1", "agent: scout");
    expect(forkedPi.setSessionName).toHaveBeenCalledWith("[scout] session-1");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "scout");
    expect(forkCtx.ui.setTitle).toHaveBeenCalledWith("Pi — scout");
    expect(forkedPi.appendEntry).toHaveBeenCalledWith(ACTIVE_AGENT_TYPE, {
      name: "scout",
    });
    expect(forkedPi.setModel).toHaveBeenCalledWith({
      provider: "opencode-go",
      id: "beam-free",
    });
    expect(forkedPi.setThinkingLevel).toHaveBeenCalledWith("low");
    expect(forkedPi.setActiveTools).toHaveBeenCalledWith(["read", "grep"]);
    expect(forkCtx.ui.custom).toHaveBeenCalled();
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("failed"),
      "error",
    );
  });

  it("does not fall back to an in-place switch when the fork callback fails", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    ctx.branch.push({
      id: "msg-1",
      type: "message",
      message: { role: "user", content: "hello" },
    });
    const failingUi = {
      ...ctx.ui,
      custom: vi.fn().mockRejectedValue(new Error("popup failed")),
    };
    const forkCtx = createMockContext({ branch: ctx.branch, ui: failingUi });
    ctx.fork = vi.fn(async (_id, opts) => {
      await opts?.withSession?.(forkCtx);
      return { cancelled: false };
    }) as never;

    const cmd = pi.getCommand("agent");
    await cmd.handler("scout", ctx);

    expect(pi.appendEntry).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Agent switch failed after fork"),
      "error",
    );
  });

  it("treats a missing fork result as success once the fork callback ran", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    ctx.branch.push({
      id: "msg-1",
      type: "message",
      message: { role: "user", content: "hello" },
    });
    const forkCtx = createMockContext({ branch: ctx.branch });
    ctx.fork = vi.fn(async (_id, opts) => {
      await opts?.withSession?.(forkCtx);
      return undefined as never;
    }) as never;

    const cmd = pi.getCommand("agent");
    await cmd.handler("scout", ctx);

    expect(pi.appendEntry).not.toHaveBeenCalled();
    expect(forkCtx.ui.custom).toHaveBeenCalled();
  });

  it("switches in-place without forking when session has no history", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension();
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

  it("filters skills without injecting agent instructions", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension();
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

    // Scout specifies skills: author-pr
    expect(event.systemPromptOptions.skills.map((s) => s.name)).toEqual([
      "author-pr",
    ]);
  });

  it("resets to default agent via /agent default", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    const cmd = pi.getCommand("agent");

    await cmd.handler("scout", ctx);
    await cmd.handler("default", ctx);

    expect(pi.appendEntry).toHaveBeenCalledWith(ACTIVE_AGENT_TYPE, {
      name: null,
    });
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", undefined);
    expect(ctx.ui.setTitle).toHaveBeenCalledWith("Pi");
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
    expect(event.systemPromptOptions.sections.agent).toBe("existing");
    expect(event.systemPromptOptions.skills).toHaveLength(1);
  });

  it("restores active agent on session_start from custom entry", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension();
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
    expect(event.systemPromptOptions.sections.agent).toBeUndefined();
  });

  it("ignores malformed persisted agent entries", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    ctx.branch.push(
      {
        id: "custom-1",
        type: "custom",
        customType: ACTIVE_AGENT_TYPE,
        data: { name: "engineer" },
      },
      {
        id: "custom-2",
        type: "custom",
        customType: ACTIVE_AGENT_TYPE,
        data: {},
      },
    );

    await Promise.all(pi.emit("session_start", {}, ctx));

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "engineer");
  });

  it("restores default from an explicit null reset entry", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    ctx.branch.push(
      {
        id: "custom-1",
        type: "custom",
        customType: ACTIVE_AGENT_TYPE,
        data: { name: "engineer" },
      },
      {
        id: "custom-2",
        type: "custom",
        customType: ACTIVE_AGENT_TYPE,
        data: { name: null },
      },
    );

    await Promise.all(pi.emit("session_start", {}, ctx));

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", undefined);
  });

  it("filters codemode-only tools out of the restored default set", async () => {
    const pi = createMockPi();
    pi.getActiveTools.mockReturnValue(["read", "web_search", "codemode"]);
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    const cmd = pi.getCommand("agent");
    await cmd.handler("scout", ctx);
    await cmd.handler("default", ctx);

    expect(pi.setActiveTools).toHaveBeenLastCalledWith(["read", "codemode"]);
  });

  it("restores the host default tool set on /agent default after reload or resume with a restricted agent active (T210)", async () => {
    const pi = createMockPi();
    // Simulate a session resumed/reloaded while scout was active with restricted tools:
    pi.getActiveTools.mockReturnValue(["read", "grep"]);
    pi.getAllTools.mockReturnValue([
      { name: "read", exposure: "direct", defaultActive: true },
      { name: "edit", exposure: "direct", defaultActive: true },
      { name: "bash", exposure: "direct", defaultActive: true },
      { name: "grep", exposure: "direct", defaultActive: true },
      { name: "powershell", exposure: "direct", defaultActive: false },
      { name: "web_search", exposure: "codemode", defaultActive: true },
      { name: "codemode", exposure: "model-only", defaultActive: true },
    ] as never);
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    ctx.branch.push({
      id: "custom-1",
      type: "custom",
      customType: ACTIVE_AGENT_TYPE,
      data: { name: "scout" },
    });

    await Promise.all(pi.emit("session_start", {}, ctx));
    expect(pi.setActiveTools).toHaveBeenLastCalledWith(["read", "grep"]);

    const cmd = pi.getCommand("agent");
    await cmd.handler("default", ctx);

    expect(pi.setActiveTools).toHaveBeenLastCalledWith([
      "read",
      "edit",
      "bash",
      "grep",
      "codemode",
    ]);
  });

  it("snapshots the live base tool set on first switch away from default so later-enabled tools survive (T211)", async () => {
    const pi = createMockPi();
    // At session_start, codemode has not yet swapped active tools:
    pi.getActiveTools.mockReturnValue(["read", "edit", "bash", "grep"]);
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    await Promise.all(pi.emit("session_start", {}, ctx));

    // Later (after session_start), codemode swaps active tools or user disables bash:
    pi.getActiveTools.mockReturnValue(["read", "edit", "codemode"]);

    const cmd = pi.getCommand("agent");
    await cmd.handler("scout", ctx);
    expect(pi.setActiveTools).toHaveBeenLastCalledWith(["read", "grep"]);

    await cmd.handler("default", ctx);
    expect(pi.setActiveTools).toHaveBeenLastCalledWith([
      "read",
      "edit",
      "codemode",
    ]);
  });

  it("does not overwrite session mode on session_start when no agent is active", async () => {
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    const enterModeSpy = vi.fn();
    (ctx.sessionManager as Record<string, unknown>).appendCustomEntry =
      enterModeSpy;

    await Promise.all(pi.emit("session_start", {}, ctx));
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", undefined);
    expect(enterModeSpy).not.toHaveBeenCalled();
  });

  it("auto-activates configured default agent on clean session_start", async () => {
    writeFileSync(
      join(testDir, "agent.json"),
      JSON.stringify({ default: "engineer" }),
    );
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    await Promise.all(pi.emit("session_start", {}, ctx));

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "engineer");
    expect(ctx.ui.setTitle).toHaveBeenCalledWith("Pi — engineer");
    expect(pi.setModel).toHaveBeenCalledWith({
      provider: "opencode-go",
      id: "deepseek-v4.1-flash",
    });
    expect(pi.setThinkingLevel).toHaveBeenCalledWith("high");
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it("does not auto-activate configured default agent when session has an active agent", async () => {
    writeFileSync(
      join(testDir, "agent.json"),
      JSON.stringify({ default: "engineer" }),
    );
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    ctx.branch.push({
      id: "custom-1",
      type: "custom",
      customType: ACTIVE_AGENT_TYPE,
      data: { name: "scout" },
    });

    await Promise.all(pi.emit("session_start", {}, ctx));

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "scout");
    expect(ctx.ui.setTitle).toHaveBeenCalledWith("Pi — scout");
  });

  it("does not auto-activate configured default agent when session explicitly reset to default", async () => {
    writeFileSync(
      join(testDir, "agent.json"),
      JSON.stringify({ default: "engineer" }),
    );
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    ctx.branch.push({
      id: "custom-1",
      type: "custom",
      customType: ACTIVE_AGENT_TYPE,
      data: { name: null },
    });

    await Promise.all(pi.emit("session_start", {}, ctx));

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", undefined);
    expect(ctx.ui.setTitle).toHaveBeenCalledWith("Pi");
  });

  it("notifies warning and falls back to default when configured default agent is not found", async () => {
    writeFileSync(
      join(testDir, "agent.json"),
      JSON.stringify({ default: "nonexistent-agent" }),
    );
    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext();
    await Promise.all(pi.emit("session_start", {}, ctx));

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(
        'configured default agent "nonexistent-agent" not found',
      ),
      "warning",
    );
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", undefined);
  });

  it("prefers trusted project agent.json default over user agent.json", async () => {
    writeFileSync(
      join(testDir, "agent.json"),
      JSON.stringify({ default: "engineer" }),
    );
    const projectDir = join(testDir, "proj");
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    writeFileSync(
      join(projectDir, ".pi", "agent.json"),
      JSON.stringify({ default: "scout" }),
    );

    const pi = createMockPi();
    const ext = createAgentExtension();
    ext(pi as never);

    const ctx = createMockContext({
      cwd: projectDir,
      isProjectTrusted: () => true,
    });
    await Promise.all(pi.emit("session_start", {}, ctx));

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("agent", "scout");
    expect(ctx.ui.setTitle).toHaveBeenCalledWith("Pi — scout");
  });
});
