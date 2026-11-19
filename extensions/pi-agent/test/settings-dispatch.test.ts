import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

let baseDir: string;
let agentDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pi-agent-settings-dispatch-"));
  agentDir = join(baseDir, "agent");
  mkdirSync(join(agentDir, "agents"), { recursive: true });
  writeFileSync(
    join(agentDir, "agents", "analyst.md"),
    "---\nname: analyst\ndescription: Data analysis\n---\nInstructions\n",
  );
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
  rmSync(baseDir, { recursive: true, force: true });
});

function createPi() {
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  const pi = {
    on: vi.fn(() => () => {}),
    registerTool: vi.fn(),
    registerShortcut: vi.fn(),
    registerCommand: vi.fn(
      (
        name: string,
        def: { handler: (args: string, ctx: unknown) => Promise<void> },
      ) => {
        commands.set(name, def);
      },
    ),
    events: { on: vi.fn(), emit: vi.fn() },
    getCommands: vi.fn(() => []),
    appendEntry: vi.fn(),
    setActiveTools: vi.fn(),
    getAllTools: vi.fn(() => []),
  };
  return { pi, commands };
}

function createCtx() {
  let component:
    | { render(width: number): string[]; handleInput(data: string): void }
    | undefined;
  const notify = vi.fn();
  const custom = vi.fn(
    (
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: () => void,
      ) => { render(width: number): string[]; handleInput(data: string): void },
    ) =>
      new Promise<void>((resolve) => {
        component = factory(
          { requestRender: vi.fn() },
          {
            fg: (_token: string, text: string) => text,
            bold: (text: string) => text,
          },
          {},
          resolve,
        );
      }),
  );
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: baseDir,
    isProjectTrusted: () => true,
    ui: { custom, notify, select: vi.fn(), input: vi.fn() },
  };
  return { ctx, notify, custom, component: () => component };
}

describe("agent settings subcommand execution", () => {
  it("opens default-agent settings under /agent and persists the choice", async () => {
    const { pi, commands } = createPi();
    extension(pi as never);
    const command = commands.get("agent");
    if (!command) throw new Error("Missing /agent command");
    const env = createCtx();
    const pending = command.handler("settings", env.ctx);
    await vi.waitFor(() => expect(env.component()).toBeDefined());
    expect(env.custom).toHaveBeenCalledTimes(1);
    expect(env.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("Unknown agent"),
      "error",
    );
    const rendered = env.component()?.render(80).join("\n") ?? "";
    expect(rendered).toContain("Default agent");

    env.component()?.handleInput("\r");
    env.component()?.handleInput("\x1b");
    await pending;
    const saved = JSON.parse(
      readFileSync(join(agentDir, "agent.json"), "utf8"),
    ) as { default?: string };
    expect(saved.default).toBe("analyst");
  });

  it("handles /agent settings on non-TUI contexts according to hasUI", async () => {
    const { pi, commands } = createPi();
    extension(pi as never);
    const command = commands.get("agent");
    if (!command) throw new Error("Missing /agent command");

    const printUi = createCtx();
    await command.handler("settings", {
      ...printUi.ctx,
      mode: "print",
      hasUI: true,
    });
    expect(printUi.custom).not.toHaveBeenCalled();
    expect(printUi.notify).toHaveBeenCalledWith(
      expect.stringContaining("Agent settings requires TUI mode; edit "),
      "info",
    );

    const headless = createCtx();
    await command.handler("settings", {
      ...headless.ctx,
      mode: "print",
      hasUI: false,
    });
    expect(headless.custom).not.toHaveBeenCalled();
    expect(headless.notify).not.toHaveBeenCalled();
  });
});
