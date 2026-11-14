import { describe, expect, it, vi } from "vitest";
import type { DashboardSessionItem } from "./sessions.js";
import { type DashboardViewResult, showDashboardOverlay } from "./view.js";

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
};

function makeSession(id: string, title: string): DashboardSessionItem {
  return {
    id,
    path: `/tmp/${id}.jsonl`,
    cwd: "/repo",
    created: new Date("2026-01-01T00:00:00Z"),
    modified: new Date("2026-01-01T01:00:00Z"),
    messageCount: 4,
    firstMessage: title,
    summary: {},
  };
}

function overlayHarness() {
  let component:
    | {
        render(width: number): string[];
        handleInput(data: string): void;
      }
    | undefined;
  const ctx = {
    mode: "tui",
    ui: {
      custom: vi.fn(
        (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: (result: DashboardViewResult) => void,
          ) => {
            render(width: number): string[];
            handleInput(data: string): void;
          },
        ) =>
          new Promise<DashboardViewResult>((resolve) => {
            component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
          }),
      ),
    },
  };
  return { ctx, component: () => component };
}

describe("showDashboardOverlay", () => {
  it("navigates sessions and resumes selection on Enter", async () => {
    const h = overlayHarness();
    const s1 = makeSession("s1", "first task");
    const s2 = makeSession("s2", "second task");
    const pending = showDashboardOverlay(h.ctx as never, {
      initialSessions: [s1, s2],
      loadSessions: async () => [s1, s2],
      getStateInput: () => ({ cwd: "/repo", model: "claude-sonnet-4-5" }),
      snapshotOwner: {},
    });
    await vi.waitFor(() => expect(h.component()).toBeDefined());

    const rendered = h.component()?.render(76).join("\n") ?? "";
    expect(rendered).toContain("Dashboard");
    expect(rendered).toContain("first task");
    expect(rendered).toContain("second task");

    h.component()?.handleInput("j");
    h.component()?.handleInput("\r");
    await expect(pending).resolves.toEqual({ type: "resume", session: s2 });
  });

  it("toggles project/all scope on Tab and triggers settings on s", async () => {
    const h = overlayHarness();
    const loadSessions = vi.fn(async (scope: "cwd" | "all") =>
      scope === "all" ? [makeSession("all1", "other repo")] : [],
    );
    const pending = showDashboardOverlay(h.ctx as never, {
      initialSessions: [],
      loadSessions,
      getStateInput: () => ({ cwd: "/repo" }),
      snapshotOwner: {},
    });
    await vi.waitFor(() => expect(h.component()).toBeDefined());

    h.component()?.handleInput("\t");
    await vi.waitFor(() => expect(loadSessions).toHaveBeenCalledWith("all"));

    h.component()?.handleInput("s");
    await expect(pending).resolves.toEqual({ type: "settings" });
  });

  it("returns quick action command on shortcut key", async () => {
    const h = overlayHarness();
    const pending = showDashboardOverlay(h.ctx as never, {
      initialSessions: [],
      loadSessions: async () => [],
      getStateInput: () => ({ cwd: "/repo" }),
      snapshotOwner: {},
    });
    await vi.waitFor(() => expect(h.component()).toBeDefined());

    h.component()?.handleInput("t");
    await expect(pending).resolves.toEqual({
      type: "command",
      command: "/todos",
    });
  });
});
