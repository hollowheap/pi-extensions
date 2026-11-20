import { describe, expect, it, vi } from "vitest";
import { showDashboardOverlay } from "../src/view.js";

const theme = {
  fg: (_color: unknown, text: string) => text,
  bold: (text: string) => text,
} as never;

type Component = {
  render: (width: number) => string[];
  handleInput: (data: string) => void;
};
type Factory = (
  tui: unknown,
  theme: unknown,
  keybindings: unknown,
  done: (value: unknown) => void,
) => Component;

describe("dashboard quick-action overlay", () => {
  it("exposes model, thinking, and sessions actions", async () => {
    let component: Component | undefined;
    const ctx = {
      mode: "tui",
      ui: {
        custom: vi.fn((factory: Factory) => {
          const done = vi.fn();
          component = factory(
            { requestRender: vi.fn() },
            theme,
            { matches: () => false },
            done,
          );
          done({ type: "close" });
          return Promise.resolve({ type: "close" });
        }),
      },
    };

    await showDashboardOverlay(ctx as never, {
      loadSessions: vi.fn(async () => []),
      initialSessions: [],
      getStateInput: () => ({ cwd: "/project" }),
      snapshotOwner: {},
    });

    expect(component).toBeDefined();
    const rendered = component?.render(90).join("\n") ?? "";
    for (const label of ["Model", "Thinking", "Sessions"]) {
      expect(rendered).toContain(label);
    }
  });

  it("all three actions remain listed at a narrow width", async () => {
    let component: Component | undefined;
    const ctx = {
      mode: "tui",
      ui: {
        custom: vi.fn((factory: Factory) => {
          component = factory(
            { requestRender: vi.fn() },
            theme,
            { matches: () => false },
            vi.fn(),
          );
          return Promise.resolve({ type: "close" });
        }),
      },
    };
    await showDashboardOverlay(ctx as never, {
      loadSessions: vi.fn(async () => []),
      initialSessions: [],
      getStateInput: () => ({ cwd: "/project" }),
      snapshotOwner: {},
    });
    const rendered = component?.render(40).join("\n") ?? "";
    for (const label of ["Model", "Thinking", "Sessions"]) {
      expect(rendered).toContain(label);
    }
  });

  it("outside TUI mode the overlay returns a close result", async () => {
    const custom = vi.fn();
    const ctx = { mode: "print", ui: { custom } };
    const result = await showDashboardOverlay(ctx as never, {
      loadSessions: vi.fn(async () => []),
      initialSessions: [],
      getStateInput: () => ({ cwd: "/project" }),
      snapshotOwner: {},
    });
    expect(result).toEqual({ type: "close" });
    expect(custom).not.toHaveBeenCalled();
  });

  it("an initial session is rendered in the overlay", async () => {
    let component: Component | undefined;
    const ctx = {
      mode: "tui",
      ui: {
        custom: vi.fn((factory: Factory) => {
          component = factory(
            { requestRender: vi.fn() },
            theme,
            { matches: () => false },
            vi.fn(),
          );
          return Promise.resolve({ type: "close" });
        }),
      },
    };
    await showDashboardOverlay(ctx as never, {
      loadSessions: vi.fn(async () => []),
      initialSessions: [
        {
          id: "s1",
          firstMessage: "hello from session",
          modified: new Date(),
          messageCount: 1,
          summary: {},
        },
      ] as never,
      getStateInput: () => ({ cwd: "/project" }),
      snapshotOwner: {},
    });
    expect(component?.render(90).join("\n")).toContain("hello from session");
  });
});
