import { describe, expect, it, vi } from "vitest";
import { showDashboardOverlay } from "./view.js";

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
  it("S207 C01: exposes only model, thinking, and sessions actions", async () => {
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
    for (const label of ["Todos", "Agent", "Grants", "Settings"]) {
      expect(rendered).not.toContain(label);
    }
  });
});
