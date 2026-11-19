import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
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
    expect(custom).toHaveBeenCalledWith(expect.any(Function), {
      overlay: true,
      overlayOptions: {
        width: "100%",
        maxHeight: "100%",
        row: 0,
        col: 0,
        margin: 0,
      },
    });
    expect(component?.render(100)).toHaveLength(12);
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
});
