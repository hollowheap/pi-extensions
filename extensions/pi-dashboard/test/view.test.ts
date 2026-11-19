import {
  type KeybindingsConfig,
  KeybindingsManager,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { DashboardSessionItem } from "../src/sessions.js";
import { type DashboardViewResult, showDashboardOverlay } from "../src/view.js";

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

function overlayHarness(userBindings: KeybindingsConfig = {}) {
  let component:
    | {
        render(width: number): string[];
        handleInput(data: string): void;
      }
    | undefined;
  const done = vi.fn();
  let draft = "unfinished draft";
  const setText = (text: string) => {
    draft = text;
  };
  const submit = vi.fn(() => setText(""));
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
          _options: unknown,
        ) =>
          new Promise<DashboardViewResult>((resolve) => {
            component = factory(
              {
                requestRender: vi.fn(),
                getFocusedComponent: () => ({
                  onSubmit: submit,
                  getText: () => draft,
                  setText,
                }),
              },
              theme,
              new KeybindingsManager(TUI_KEYBINDINGS, userBindings),
              (result) => {
                done(result);
                resolve(result);
              },
            );
          }),
      ),
    },
  };
  return { ctx, component: () => component, done, submit, draft: () => draft };
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

  it("toggles project/all scope on Tab and keeps settings out of the overlay", async () => {
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
    expect(h.done).not.toHaveBeenCalled();
    h.component()?.handleInput("q");
    await expect(pending).resolves.toEqual({ type: "close" });
  });

  it("honors initialScope and maxItems from options", async () => {
    const h = overlayHarness();
    const sessions = Array.from({ length: 12 }, (_, i) =>
      makeSession(`s${i}`, `task ${i + 1}`),
    );
    const pending = showDashboardOverlay(h.ctx as never, {
      initialSessions: sessions,
      initialScope: "all",
      maxItems: 3,
      loadSessions: async () => sessions,
      getStateInput: () => ({ cwd: "/repo" }),
      snapshotOwner: {},
    });
    await vi.waitFor(() => expect(h.component()).toBeDefined());

    const rendered = h.component()?.render(90).join("\n") ?? "";
    expect(rendered).toContain("Scope: all workspaces");
    expect(rendered).toContain("1-3 resume");
    expect(rendered).not.toContain("task 4");

    h.component()?.handleInput("3");
    await expect(pending).resolves.toEqual({
      type: "resume",
      session: sessions[2],
    });
  });

  it.each([
    ["m", "/model"],
    ["t", "/thinking"],
    ["l", "/resume"],
  ])(
    "dispatches shortcut %s to Pi as %s and preserves the draft",
    async (key, command) => {
      const h = overlayHarness();
      const pending = showDashboardOverlay(h.ctx as never, {
        initialSessions: [],
        loadSessions: async () => [],
        getStateInput: () => ({ cwd: "/repo" }),
        snapshotOwner: {},
      });
      await vi.waitFor(() => expect(h.component()).toBeDefined());

      h.component()?.handleInput(key);
      await expect(pending).resolves.toEqual({ type: "command", command });
      expect(h.submit).toHaveBeenCalledExactlyOnceWith(command);
      expect(h.draft()).toBe("unfinished draft");
    },
  );

  it("ignores multi-character numeric input instead of matching lexicographically", async () => {
    const h = overlayHarness();
    const sessions = Array.from({ length: 12 }, (_, i) =>
      makeSession(`s${i}`, `task ${i + 1}`),
    );
    void showDashboardOverlay(h.ctx as never, {
      initialSessions: sessions,
      loadSessions: async () => sessions,
      getStateInput: () => ({ cwd: "/repo" }),
      snapshotOwner: {},
    });
    await vi.waitFor(() => expect(h.component()).toBeDefined());

    h.component()?.handleInput("10");
    await Promise.resolve();
    expect(h.done).not.toHaveBeenCalled();
  });

  it("numbers only the rows reachable with single-digit shortcuts", async () => {
    const h = overlayHarness();
    const sessions = Array.from({ length: 12 }, (_, i) =>
      makeSession(`s${i}`, `task ${i + 1}`),
    );
    const pending = showDashboardOverlay(h.ctx as never, {
      initialSessions: sessions,
      maxItems: 12,
      loadSessions: async () => sessions,
      getStateInput: () => ({ cwd: "/repo" }),
      snapshotOwner: {},
    });
    await vi.waitFor(() => expect(h.component()).toBeDefined());

    const rendered = h.component()?.render(90).join("\n") ?? "";
    expect(rendered).toContain("1-9 resume");
    expect(rendered).not.toContain("10.");
    expect(rendered).not.toContain("task 10");

    h.component()?.handleInput("9");
    await expect(pending).resolves.toEqual({
      type: "resume",
      session: sessions[8],
    });
  });

  it("keeps arrow navigation within the displayed rows", async () => {
    const h = overlayHarness();
    const sessions = Array.from({ length: 12 }, (_, i) =>
      makeSession(`s${i}`, `task ${i + 1}`),
    );
    const pending = showDashboardOverlay(h.ctx as never, {
      initialSessions: sessions,
      maxItems: 12,
      loadSessions: async () => sessions,
      getStateInput: () => ({ cwd: "/repo" }),
      snapshotOwner: {},
    });
    await vi.waitFor(() => expect(h.component()).toBeDefined());

    for (let i = 0; i < 10; i += 1) {
      h.component()?.handleInput("\x1b[B");
    }
    h.component()?.handleInput("\r");

    await expect(pending).resolves.toEqual({
      type: "resume",
      session: sessions[1],
    });
  });

  it("honors remapped select keybindings", async () => {
    const h = overlayHarness({
      "tui.select.up": "ctrl+e",
      "tui.select.down": "ctrl+y",
      "tui.select.confirm": "ctrl+g",
      "tui.select.cancel": "ctrl+x",
    });
    const s1 = makeSession("s1", "first task");
    const s2 = makeSession("s2", "second task");
    const s3 = makeSession("s3", "third task");
    const pending = showDashboardOverlay(h.ctx as never, {
      initialSessions: [s1, s2, s3],
      loadSessions: async () => [s1, s2, s3],
      getStateInput: () => ({ cwd: "/repo" }),
      snapshotOwner: {},
    });
    await vi.waitFor(() => expect(h.component()).toBeDefined());

    h.component()?.handleInput("\x19");
    h.component()?.handleInput("\x19");
    h.component()?.handleInput("\x05");
    h.component()?.handleInput("\x07");

    await expect(pending).resolves.toEqual({ type: "resume", session: s2 });
  });
});
