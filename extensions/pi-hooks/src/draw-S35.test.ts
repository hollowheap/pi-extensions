import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";

afterEach(() => {
  Reflect.deleteProperty(process.env, "PI_HOOKS_DISCOVER_SKILL");
});

function setup() {
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
    {};
  const pi = {
    on: vi.fn(
      (event: string, handler: (event: never, ctx: never) => unknown) => {
        handlers[event] = handler as (event: unknown, ctx: unknown) => unknown;
        return () => {};
      },
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    appendEntry: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
  };
  extension(pi as never);
  return { pi, handlers };
}

describe("S35: the bundled skill is opt-in via PI_HOOKS_DISCOVER_SKILL", () => {
  it("stays undiscoverable by default and is contributed when the flag is set", async () => {
    expect(setup().handlers.resources_discover).toBeUndefined();

    process.env.PI_HOOKS_DISCOVER_SKILL = "1";
    const { handlers } = setup();
    const result = (await handlers.resources_discover(
      { type: "resources_discover", cwd: process.cwd(), reason: "startup" },
      {},
    )) as { skillPaths?: string[] };
    expect(result.skillPaths).toHaveLength(1);
    expect(result.skillPaths?.[0]).toContain("hooks-init");
  });
});
