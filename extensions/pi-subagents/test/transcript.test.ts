import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { getStatuslineHeight, setStatuslineHeight } from "@hollowheap/ui/state";
import { getVisibleWidgetHeight } from "@hollowheap/ui/widget";
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
        maxHeight: number;
      };
    };
    expect(options.overlay).toBe(true);
    setStatuslineHeight(2);
    expect(getStatuslineHeight()).toBe(2);
    expect(getVisibleWidgetHeight()).toBe(0);
    const bounds = options.overlayOptions();
    expect(bounds.width).toBe("100%");
    expect(bounds.row).toBe(0);
    expect(bounds.col).toBe(0);
    expect(bounds.maxHeight).toBe(1);
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
    setStatuslineHeight(0);
    await result;
  });

  it("deducts statusline height from a tall transcript overlay", async () => {
    let options: { overlayOptions: () => { maxHeight: number } } | undefined;
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keys: unknown,
          done: (value: undefined) => void,
        ) => unknown,
        opts: { overlayOptions: () => { maxHeight: number } },
      ) => {
        options = opts;
        factory(
          { terminal: { rows: 12 }, requestRender: vi.fn() },
          {},
          {},
          () => {},
        );
        return Promise.resolve();
      },
    );
    setStatuslineHeight(2);
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
      expect(options?.overlayOptions().maxHeight).toBe(10);
    } finally {
      setStatuslineHeight(0);
    }
  });
});
