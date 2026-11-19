import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentExtension } from "../src/index.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
let testDir: string;

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

function createMockPi() {
  const commands = new Map<
    string,
    { handler: (arg: string, ctx: unknown) => Promise<void> }
  >();
  const handlers = new Map<
    string,
    Array<(event: unknown, ctx: unknown) => unknown>
  >();
  return {
    on: vi.fn(
      (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
    ),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? [])
        (handler as (...values: unknown[]) => unknown)(...args);
    }),
    registerCommand: vi.fn(
      (
        name: string,
        def: { handler: (arg: string, ctx: unknown) => Promise<void> },
      ) => {
        commands.set(name, def);
      },
    ),
    appendEntry: vi.fn(),
    setActiveTools: vi.fn(),
    getActiveTools: vi.fn(() => ["read", "edit", "bash", "grep"]),
    getAllTools: vi.fn(() => [
      { name: "read", exposure: "direct" },
      { name: "edit", exposure: "direct" },
      { name: "bash", exposure: "direct" },
      { name: "grep", exposure: "direct" },
    ]),
    setModel: vi.fn().mockResolvedValue(true),
    getThinkingLevel: vi.fn(() => "medium"),
    setThinkingLevel: vi.fn(),
    setSessionName: vi.fn(),
    getSessionName: vi.fn(() => "session-1"),
    setLabel: vi.fn(),
    events: { emit: vi.fn(), on: vi.fn() },
    getCommand: (name: string) =>
      commands.get(name) as {
        handler: (arg: string, ctx: unknown) => Promise<void>;
      },
  };
}

function createMockContext() {
  return {
    cwd: testDir,
    hasUI: true,
    mode: "tui",
    isProjectTrusted: () => true,
    sessionManager: { getBranch: vi.fn(() => []) },
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setTitle: vi.fn(),
      select: vi.fn(),
      confirm: vi.fn(),
      custom: vi.fn().mockResolvedValue(undefined),
    },
    modelRegistry: {
      getAll: vi.fn(() => [{ provider: "opencode-go", id: "beam-free" }]),
    },
  };
}

function setupAgents() {
  testDir = mkdtempSync(join(tmpdir(), "base-tool-restoration-agent-"));
  process.env.PI_CODING_AGENT_DIR = testDir;
  const agentsDir = join(testDir, "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    join(agentsDir, "scout.md"),
    "---\nname: scout\ndescription: Recon\ntools: read,grep\n---\nScout instructions\n",
  );
  return createMockPi();
}

describe("default tool restore", () => {
  it("restores the host default tool set when switching back to the default agent", async () => {
    testDir = mkdtempSync(join(tmpdir(), "base-tool-restoration-agent-"));
    process.env.PI_CODING_AGENT_DIR = testDir;
    const agentsDir = join(testDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, "scout.md"),
      "---\nname: scout\ndescription: Recon\ntools: read\n---\nScout instructions\n",
    );

    const pi = createMockPi();
    createAgentExtension()(pi as never);
    const ctx = createMockContext();
    const command = pi.getCommand("agent");

    await command.handler("scout", ctx);
    await command.handler("default", ctx);

    expect(pi.setActiveTools).toHaveBeenCalledWith([
      "read",
      "edit",
      "bash",
      "grep",
    ]);
  });

  it("an unknown agent name notifies an error without changing tools", async () => {
    const pi = setupAgents();
    createAgentExtension()(pi as never);
    const ctx = createMockContext();

    await pi.getCommand("agent").handler("does-not-exist", ctx);

    const notified = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock;
    expect(
      notified.calls.some((call) => String(call[0]).includes("Unknown agent")),
    ).toBe(true);
    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });

  it("switching to a configured agent activates only its allowed tools", async () => {
    const pi = setupAgents();
    createAgentExtension()(pi as never);
    const ctx = createMockContext();

    await pi.getCommand("agent").handler("scout", ctx);

    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "grep"]);
  });

  it("a headless no-argument command lists available agents", async () => {
    const pi = setupAgents();
    createAgentExtension()(pi as never);
    const ctx = createMockContext();
    ctx.mode = "cli";
    ctx.hasUI = false;

    await pi.getCommand("agent").handler("", ctx);

    const notified = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock;
    expect(
      notified.calls.some((call) =>
        String(call[0]).includes("Available agents: default, scout"),
      ),
    ).toBe(true);
    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });
});
