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
