import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CURRENT_SESSION_VERSION,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { registerSharedHeader } from "@hollowheap/ui/header";
import { describe, expect, it, vi } from "vitest";
import {
  formatChildTranscript,
  showSubagentTranscript,
} from "../src/transcript.js";

describe("read-only subagent transcript", () => {
  it("renders the current child branch and preserves fenced Markdown", () => {
    const records = [
      {
        type: "session",
        version: CURRENT_SESSION_VERSION,
        id: "child",
        cwd: "/work",
        timestamp: new Date().toISOString(),
      },
      {
        type: "message",
        id: "1",
        parentId: null,
        message: { role: "user", content: "Original question" },
      },
      {
        type: "message",
        id: "2",
        parentId: "1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Old branch" }],
        },
      },
      {
        type: "message",
        id: "3",
        parentId: "1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "```ts\nconst answer = 1;\n```" }],
        },
      },
    ];
    const formatted = formatChildTranscript(
      records.map((entry) => JSON.stringify(entry)).join("\n"),
    );
    expect(formatted).toContain("## User\n\nOriginal question");
    expect(formatted).toContain("## Assistant\n\n```ts\nconst answer = 1;");
    expect(formatted).not.toContain("Old branch");
  });

  it("fills the viewport, switches children with Alt navigation, and leaves the prompt alone", async () => {
    const theme = {
      fg: (_token: string, value: string) => value,
      bold: (value: string) => value,
    };
    let component:
      | { render(width: number): string[]; handleInput(data: string): void }
      | undefined;
    const setEditorText = vi.fn();
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keys: unknown,
          done: () => void,
        ) => NonNullable<typeof component>,
        _options?: unknown,
      ) =>
        new Promise<void>((resolve) => {
          component = factory(
            { terminal: { rows: 12 }, requestRender: vi.fn() },
            theme,
            {},
            resolve,
          );
        }),
    );
    const ctx = { mode: "tui", hasUI: true, ui: { custom, setEditorText } };
    const result = showSubagentTranscript(
      ctx as never,
      "/path-without-child-sessions",
      [
        { id: "one", agent: "scout" },
        { id: "two", agent: "worker" },
      ] as never,
      "one",
      (id) => `Transcript for ${id}`,
    );
    await vi.waitFor(() => expect(custom).toHaveBeenCalled());
    const options = custom.mock.calls[0][1] as {
      overlay: boolean;
      overlayOptions: () => {
        width: string;
        row: number;
        col: number;
        maxHeight: string;
      };
    };
    expect(options.overlay).toBe(true);
    const bounds = options.overlayOptions();
    expect(bounds.width).toBe("100%");
    expect(bounds.row).toBe(0);
    expect(bounds.col).toBe(0);
    expect(bounds.maxHeight).toBe("100%");
    const rendered = component?.render(100) ?? [];
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.join("\n")).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
    expect(component?.render(100).join("\n")).toContain("Transcript for one");
    component?.handleInput("\x1bl");
    expect(component?.render(100).join("\n")).toContain("Transcript for two");
    component?.handleInput("\x1b[1;3D");
    expect(component?.render(100).join("\n")).toContain("Transcript for one");
    component?.handleInput("arbitrary typed text");
    expect(setEditorText).not.toHaveBeenCalled();
    component?.handleInput("\x1b");
    await result;
  });

  it("uses the host message components with theme colors and returns to the main agent at the left edge", async () => {
    initTheme();
    const agentDir = mkdtempSync(join(tmpdir(), "pi-subagent-transcript-"));
    const sessionsDir = join(agentDir, "sessions");
    mkdirSync(sessionsDir);
    const session = join(sessionsDir, "child.jsonl");
    const records = [
      {
        type: "session",
        version: CURRENT_SESSION_VERSION,
        id: "child",
        cwd: "/work",
        timestamp: new Date().toISOString(),
      },
      {
        type: "message",
        id: "1",
        parentId: null,
        message: { role: "user", content: "Theme question" },
      },
      {
        type: "message",
        id: "2",
        parentId: "1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Theme answer" }],
        },
      },
    ];
    writeFileSync(
      session,
      records.map((entry) => JSON.stringify(entry)).join("\n"),
    );

    const theme = {
      fg: (token: string, value: string) => `[${token}:${value}]`,
      bg: (token: string, value: string) => `[bg:${token}:${value}]`,
      bold: (value: string) => value,
    };
    let component:
      | { render(width: number): string[]; handleInput(data: string): void }
      | undefined;
    const done = vi.fn();
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keys: unknown,
          finish: () => void,
        ) => NonNullable<typeof component>,
      ) => {
        component = factory(
          { terminal: { rows: 24 }, requestRender: vi.fn() },
          theme,
          {},
          done,
        );
        return Promise.resolve();
      },
    );
    try {
      await showSubagentTranscript(
        { mode: "tui", hasUI: true, ui: { custom } } as never,
        agentDir,
        [{ id: "child", agent: "scout", session }] as never,
        "child",
        () => "fallback",
      );
      const rendered = component?.render(120).join("\n") ?? "";
      expect(rendered).toContain("Theme question");
      expect(rendered).toContain("Theme answer");
      expect(rendered).toContain("\u001b[");
      expect(done).not.toHaveBeenCalled();

      component?.handleInput("\x1b[1;3D");
      expect(done).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("uses the full terminal height and reuses the dashboard header renderer", async () => {
    const release = registerSharedHeader({
      render: (width) => ["Shared dashboard", `width:${width}`],
    });
    let options: { overlayOptions: () => { maxHeight: string } } | undefined;
    let component:
      | { render(width: number): string[]; handleInput(data: string): void }
      | undefined;
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keys: unknown,
          done: (value: undefined) => void,
        ) => NonNullable<typeof component>,
        opts: { overlayOptions: () => { maxHeight: string } },
      ) => {
        options = opts;
        component = factory(
          { terminal: { rows: 12 }, requestRender: vi.fn() },
          {},
          {},
          () => {},
        );
        return Promise.resolve();
      },
    );
    try {
      await showSubagentTranscript(
        {
          mode: "tui",
          hasUI: true,
          ui: { custom, setEditorText: vi.fn() },
        } as never,
        "/no-child-session",
        [{ id: "one", agent: "scout" }] as never,
        "one",
        () =>
          `Transcript for one\n${Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n")}`,
      );
      expect(options?.overlayOptions().maxHeight).toBe("100%");
      const lines = component?.render(80) ?? [];
      expect(lines).toHaveLength(12);
      expect(lines[0]).toBe("Shared dashboard");
      expect(lines[1]).toBe("width:80");
    } finally {
      release();
    }
  });
});
