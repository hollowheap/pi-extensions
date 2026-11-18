import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

afterEach(() => {
  Reflect.deleteProperty(process.env, "HOLLOWHEAP_ACP_SOCKET");
  Reflect.deleteProperty(process.env, "HOLLOWHEAP_ACP_CAPS");
});

describe("S15: ACP ask fails closed without a client", () => {
  it("blocks and never opens a permission request when no client is connected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "draw-s15-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "permissions.json"),
      JSON.stringify({ rules: [] }),
    );
    const pi = {
      on: vi.fn(
        (_event: string, _fn: (event: never, ctx: never) => unknown) =>
          () => {},
      ),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    extension(pi as never);
    const handlers = Object.fromEntries(
      pi.on.mock.calls.map(([event, fn]) => [event, fn]),
    ) as Record<string, (event: never, ctx: never) => unknown>;
    const ctx = {
      cwd: dir,
      sessionManager: {},
      hasUI: false,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm: vi.fn(), setStatus: vi.fn() },
    };
    handlers.session_start?.(undefined as never, ctx as never);

    const result = (await handlers.tool_call?.(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "write",
        input: { path: "src/x.ts" },
      } as never,
      ctx as never,
    )) as { block: boolean; reason: string };

    expect(result.block).toBe(true);
    expect(result.reason).toContain("no client connected");
    expect(pi.events.emit).not.toHaveBeenCalledWith(
      "permission",
      expect.anything(),
    );
  });
});

describe("S15: allow boundary, explicit deny and restored-mode consumer", () => {
  function setupAcp(rules: string[], sessionManager: object = {}) {
    const dir = mkdtempSync(join(tmpdir(), "draw-s15-extra-"));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "permissions.json"),
      JSON.stringify({ rules }),
    );
    const pi = {
      on: vi.fn(
        (_event: string, _fn: (event: never, ctx: never) => unknown) =>
          () => {},
      ),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    extension(pi as never);
    const handlers = Object.fromEntries(
      pi.on.mock.calls.map(([event, fn]) => [event, fn]),
    ) as Record<string, (event: never, ctx: never) => unknown>;
    const ctx = {
      cwd: dir,
      sessionManager,
      hasUI: false,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm: vi.fn(), setStatus: vi.fn() },
    };
    handlers.session_start?.(undefined as never, ctx as never);
    const callWrite = () =>
      handlers.tool_call?.(
        {
          type: "tool_call",
          toolCallId: "1",
          toolName: "write",
          input: { path: "src/x.ts" },
        } as never,
        ctx as never,
      ) as Promise<{ block: boolean; reason: string } | undefined>;
    return { pi, ctx, callWrite };
  }

  it("S15 C02: an allowed write needs no client and is not blocked", async () => {
    const { callWrite } = setupAcp(["allow edit *"]);
    await expect(callWrite()).resolves.toBeUndefined();
  });

  it("S15 C03: a denied write blocks with a denial reason and opens no request", async () => {
    const { pi, callWrite } = setupAcp(["deny edit *"]);
    const result = await callWrite();
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("denied");
    expect(pi.events.emit).not.toHaveBeenCalledWith(
      "permission",
      expect.anything(),
    );
  });

  it("S15 C04: a persisted plan mode restored at session start denies a normal edit", async () => {
    const entries = [
      { customType: "hollowheap.core.mode", data: { mode: "plan" } },
    ];
    const { callWrite } = setupAcp(["allow edit *"], {
      getEntries: () => entries,
    });
    const result = await callWrite();
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("denied");
  });
});
