import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import extension from "./extension.js";

type Handler = (event: never, ctx: never) => Promise<unknown>;

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setup(rules: unknown) {
  const root = mkdtempSync(join(tmpdir(), "pi-policy-"));
  dirs.push(root);
  mkdirSync(join(root, ".pi"), { recursive: true });
  writeFileSync(
    join(root, ".pi", "permissions.json"),
    JSON.stringify({ rules }),
  );
  state.agentDir = join(root, "agent");
  expect(getAgentDir()).toBe(state.agentDir);

  let handler: Handler | undefined;
  const pi = {
    on: (event: string, fn: Handler) => {
      if (event === "tool_call") handler = fn;
    },
  };
  extension(pi as never);
  if (!handler) throw new Error("tool_call handler not registered");

  const ctx = {
    cwd: root,
    sessionManager: {},
    hasUI: false,
    isProjectTrusted: () => true,
    ui: {},
  };
  return {
    call: (toolName: string, input: unknown) =>
      handler?.(
        { type: "tool_call", toolCallId: "1", toolName, input } as never,
        ctx as never,
      ),
  };
}

describe("headless policy extension", () => {
  it("allows reads under the default mode", async () => {
    const { call } = setup([]);
    await expect(call("read", { path: "src/x.ts" })).resolves.toBeUndefined();
  });

  it("blocks denied shell commands", async () => {
    const { call } = setup(["deny shell rm -rf"]);
    await expect(call("bash", { command: "rm -rf src" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
  });

  it("blocks asks when no UI is available", async () => {
    const { call } = setup([]);
    await expect(call("bash", { command: "echo hi" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("needs approval"),
    });
  });

  it("allows shell when a rule permits it", async () => {
    const { call } = setup(["allow shell echo"]);
    await expect(call("bash", { command: "echo hi" })).resolves.toBeUndefined();
  });

  it("blocks tools without a category", async () => {
    const { call } = setup([]);
    await expect(call("mystery", {})).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("no permission category"),
    });
  });
});
