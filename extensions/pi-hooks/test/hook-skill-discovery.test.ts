import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

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

describe("the bundled skill is opt-in via PI_HOOKS_DISCOVER_SKILL", () => {
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

describe("skill discovery boundary seams", () => {
  it("only the exact flag value 1 enables discovery", () => {
    process.env.PI_HOOKS_DISCOVER_SKILL = "0";
    expect(setup().handlers.resources_discover).toBeUndefined();
    process.env.PI_HOOKS_DISCOVER_SKILL = "true";
    expect(setup().handlers.resources_discover).toBeUndefined();
  });

  it("the contributed skill path points at an on-disk SKILL.md", async () => {
    process.env.PI_HOOKS_DISCOVER_SKILL = "1";
    const { handlers } = setup();
    const result = (await handlers.resources_discover({}, {})) as {
      skillPaths: string[];
    };
    const path = result.skillPaths[0] ?? "";
    expect(path).toMatch(/hooks-init[\\/]SKILL\.md$/);
    expect(existsSync(path)).toBe(true);
  });

  it("repeated discovery yields the same single path without duplication", async () => {
    process.env.PI_HOOKS_DISCOVER_SKILL = "1";
    const { handlers } = setup();
    const first = (await handlers.resources_discover({}, {})) as {
      skillPaths: string[];
    };
    const second = (await handlers.resources_discover({}, {})) as {
      skillPaths: string[];
    };
    expect(first.skillPaths).toHaveLength(1);
    expect(second.skillPaths).toEqual(first.skillPaths);
  });
});
