import { CURSOR_MARKER, isFocusable } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { askQuestions } from "../src/index.js";

interface Component {
  render(width: number): string[];
  invalidate(): void;
  handleInput(data: string): void;
}

function createFlow(
  questions: Array<{
    prompt: string;
    mode: "free" | "single" | "multi";
    options?: string[];
  }>,
) {
  const components: Component[] = [];
  const custom = vi.fn(
    (
      factory: (
        tui: unknown,
        theme: unknown,
        keys: unknown,
        done: (value: unknown) => void,
      ) => Component,
      _options?: unknown,
    ) =>
      new Promise<unknown>((resolve) => {
        const component = factory(
          { requestRender: vi.fn() },
          { fg: (_t: string, text: string) => text, bold: (t: string) => t },
          {},
          resolve,
        );
        components.push(component);
      }),
  );
  const ctx = {
    mode: "tui",
    hasUI: true,
    sessionManager: {},
    ui: { select: vi.fn(), input: vi.fn(), custom },
  };
  const pending = askQuestions(questions as never, ctx as never);
  return { pending, components, custom };
}

async function type(
  component: Component | undefined,
  text: string,
): Promise<void> {
  if (component === undefined) throw new Error("missing dialog component");
  for (const char of text) component.handleInput(char);
}

describe("question navigation", () => {
  it("ends a completed flow in a review with edit, confirm, and cancel", async () => {
    const flow = createFlow([
      { prompt: "First?", mode: "free" },
      { prompt: "Second?", mode: "free" },
    ]);

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    expect(flow.custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ overlay: false }),
    );
    const dialog = flow.components[0];
    if (dialog === undefined) throw new Error("missing dialog component");
    await type(dialog, "alpha");
    dialog.handleInput("\r");

    await type(dialog, "beta");
    dialog.handleInput("\r");

    const rendered = dialog.render(80).join("\n");
    expect(rendered).toContain("Review");
    expect(rendered).toContain("Edit");
    expect(rendered).toContain("Confirm");
    expect(rendered).toContain("Cancel");

    dialog.handleInput("\r");
    const result = await flow.pending;
    expect(result?.cancelled).not.toBe(true);
    expect(result?.[0]).toMatchObject({ mode: "free", value: "alpha" });
    expect(result?.[1]).toMatchObject({ mode: "free", value: "beta" });
  });

  it("cancels only after review confirmation is declined", async () => {
    const flow = createFlow([{ prompt: "Pick or write", mode: "free" }]);

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    await type(flow.components[0], "alpha");
    flow.components[0]?.handleInput("\r");

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(1));
    const review = flow.components[1];
    if (review === undefined) throw new Error("missing review component");
    review.handleInput("\x1b");

    const result = await flow.pending;
    expect(result?.cancelled).toBe(true);
  });

  it("clears the draft on the first Escape without finishing, and cancels on the second", async () => {
    const flow = createFlow([{ prompt: "Pick or write", mode: "free" }]);

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    const first = flow.components[0];
    if (first === undefined) throw new Error("missing dialog component");
    await type(first, "alpha");
    expect(first.render(80).join("\n")).toContain("alpha");

    first.handleInput("\x1b");
    expect(flow.components.length).toBe(1);
    expect(first.render(80).join("\n")).not.toContain("alpha");

    first.handleInput("\x1b");
    const result = await flow.pending;
    expect(result?.cancelled).toBe(true);
  });

  it("re-opens the selected question on Edit and confirms the edited answer", async () => {
    const flow = createFlow([
      { prompt: "First?", mode: "free" },
      { prompt: "Second?", mode: "free" },
    ]);

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    const dialog = flow.components[0];
    if (dialog === undefined) throw new Error("missing dialog component");
    await type(dialog, "alpha");
    dialog.handleInput("\r");

    await type(dialog, "beta");
    dialog.handleInput("\r");

    dialog.handleInput("\x1b[D");
    dialog.handleInput("\r");

    expect(dialog.render(80).join("\n")).toContain("First?");
    await type(dialog, "ALPHA");
    dialog.handleInput("\r");
    dialog.handleInput("\t");

    expect(dialog.render(80).join("\n")).toContain("ALPHA");
    dialog.handleInput("\r");

    const result = await flow.pending;
    expect(result?.[0]).toMatchObject({ mode: "free", value: "ALPHA" });
    expect(result?.[1]).toMatchObject({ mode: "free", value: "beta" });
  });

  it("review left/right navigation preserves both answers", async () => {
    const flow = createFlow([
      { prompt: "First?", mode: "free" },
      { prompt: "Second?", mode: "free" },
    ]);
    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    const dialog = flow.components[0];
    if (dialog === undefined) throw new Error("missing dialog component");
    await type(dialog, "alpha");
    dialog.handleInput("\r");
    await type(dialog, "beta");
    dialog.handleInput("\r");
    dialog.handleInput("\x1b[D");
    dialog.handleInput("\x1b[C");
    dialog.handleInput("\r");

    const result = await flow.pending;
    expect(result?.[0]).toMatchObject({ mode: "free", value: "alpha" });
    expect(result?.[1]).toMatchObject({ mode: "free", value: "beta" });
  });

  it("dismissal before review marks cancelled without answers", async () => {
    const select = vi.fn().mockResolvedValue(undefined);
    const custom = vi.fn();
    const ctx = {
      mode: "tui",
      hasUI: true,
      sessionManager: {},
      ui: { select, input: vi.fn(), custom },
    };
    const result = await askQuestions(
      [{ mode: "single", prompt: "Pick?", options: ["A"] }],
      ctx as never,
    );
    expect(result?.cancelled).toBe(true);
    expect(custom).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  it("declining the review cancels the flow", async () => {
    const flow = createFlow([{ prompt: "Say it", mode: "free" }]);
    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    await type(flow.components[0], "alpha");
    flow.components[0]?.handleInput("\r");
    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(1));
    const review = flow.components[1];
    if (review === undefined) throw new Error("missing review component");
    expect(review.render(80).join("\n")).toContain("Cancel");
    review.handleInput("\x1b[C");
    review.handleInput("\r");

    const result = await flow.pending;
    expect(result?.cancelled).toBe(true);
    expect(result?.[0]).toMatchObject({ mode: "free", value: "alpha" });
  });

  it("switches between question tabs and Review with Tab and Shift+Tab while preserving draft state", async () => {
    const flow = createFlow([
      { prompt: "First?", mode: "free" },
      { prompt: "Pick one?", mode: "single", options: ["One", "Two"] },
      { prompt: "Pick many?", mode: "multi", options: ["X", "Y"] },
    ]);

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    const dialog = flow.components[0];
    if (dialog === undefined) throw new Error("missing dialog component");

    expect(dialog.render(80).join("\n")).toContain("\x1b[7m Q1 \x1b[27m");
    expect(dialog.render(80).join("\n")).toContain("Tab / Shift+Tab");

    await type(dialog, "draft-1");
    dialog.handleInput("\t");
    expect(dialog.render(80).join("\n")).toContain("\x1b[7m Q2 \x1b[27m");
    expect(dialog.render(80).join("\n")).toContain("Pick one?");

    dialog.handleInput("\x1b[Z");
    expect(dialog.render(80).join("\n")).toContain("\x1b[7m Q1 \x1b[27m");
    expect(dialog.render(80).join("\n")).toContain("draft-1");

    dialog.handleInput("\r");
    expect(dialog.render(80).join("\n")).toContain("\x1b[7m Q2 \x1b[27m");

    dialog.handleInput("\x1b[B");
    dialog.handleInput("\r");
    expect(dialog.render(80).join("\n")).toContain("\x1b[7m Q3 \x1b[27m");

    dialog.handleInput(" ");
    dialog.handleInput("\x1b[B");
    dialog.handleInput("\x1b[B");
    dialog.handleInput("\x1b[B");
    dialog.handleInput("\r");
    const reviewRendered = dialog.render(80).join("\n");
    expect(reviewRendered).toContain("\x1b[7m Review \x1b[27m");
    expect(reviewRendered).toContain("\x1b[7m Confirm \x1b[27m");
    expect(reviewRendered).not.toContain("[Confirm]");

    dialog.handleInput("\r");
    const result = await flow.pending;
    expect(result?.cancelled).not.toBe(true);
    expect(result?.[0]).toEqual({ mode: "free", value: "draft-1" });
    expect(result?.[1]).toEqual({ mode: "single", value: "Two" });
    expect(result?.[2]).toEqual({
      mode: "multi",
      selected: ["X"],
      writeIn: undefined,
    });
  });

  it("cancels a tabbed multi-question flow on Escape", async () => {
    const flow = createFlow([
      { prompt: "First?", mode: "single", options: ["A"] },
      { prompt: "Second?", mode: "free" },
    ]);

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    flow.components[0]?.handleInput("\x1b");

    const result = await flow.pending;
    expect(result?.cancelled).toBe(true);
  });

  it("forwards Focusable state to the active tab editor for CURSOR_MARKER", async () => {
    const flow = createFlow([
      { prompt: "Free?", mode: "free" },
      { prompt: "Pick?", mode: "single", options: ["A"] },
    ]);

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    const dialog = flow.components[0];
    if (dialog === undefined) throw new Error("missing dialog component");
    expect(isFocusable(dialog)).toBe(true);
    if (!isFocusable(dialog)) throw new Error("expected focusable dialog");

    dialog.focused = true;
    expect(dialog.render(80).join("\n")).toContain(CURSOR_MARKER);

    dialog.handleInput("\t");
    expect(dialog.render(80).join("\n")).not.toContain(CURSOR_MARKER);

    dialog.handleInput("\x1b[B");
    dialog.handleInput("\r");
    expect(dialog.render(80).join("\n")).toContain(CURSOR_MARKER);

    dialog.handleInput("\x03");
    const result = await flow.pending;
    expect(result?.cancelled).toBe(true);
  });

  it("sorts tabbed questions by page and skips disabled conditional tabs on Tab/Shift+Tab", async () => {
    const flow = createFlow([
      {
        prompt: "Follow-up?",
        mode: "free",
        page: 2,
        condition: "answer2 == 'yes'",
      } as never,
      {
        prompt: "Enable follow-up?",
        mode: "single",
        options: ["no", "yes"],
        page: 1,
      } as never,
    ]);

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    const dialog = flow.components[0];
    if (dialog === undefined) throw new Error("missing dialog component");

    expect(dialog.render(80).join("\n")).toContain("Enable follow-up?");
    dialog.handleInput("\t");
    expect(dialog.render(80).join("\n")).toContain("\x1b[7m Review \x1b[27m");
    dialog.handleInput("\x1b[Z");
    expect(dialog.render(80).join("\n")).toContain("Enable follow-up?");

    dialog.handleInput("\x1b[B");
    dialog.handleInput("\r");
    expect(dialog.render(80).join("\n")).toContain("Follow-up?");

    await type(dialog, "details");
    dialog.handleInput("\r");
    expect(dialog.render(80).join("\n")).toContain("\x1b[7m Review \x1b[27m");
    dialog.handleInput("\r");

    const result = await flow.pending;
    expect(result?.cancelled).not.toBe(true);
    expect(result?.[0]).toEqual({ mode: "free", value: "details" });
    expect(result?.[1]).toEqual({ mode: "single", value: "yes" });
  });

  it("cancels non-tabbed review on Ctrl+C and AbortSignal", async () => {
    const flow = createFlow([{ prompt: "Pick or write", mode: "free" }]);
    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    await type(flow.components[0], "alpha");
    flow.components[0]?.handleInput("\r");

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(1));
    flow.components[1]?.handleInput("\x03");
    const ctrlCResult = await flow.pending;
    expect(ctrlCResult?.cancelled).toBe(true);

    const abort = new AbortController();
    const components: Component[] = [];
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keys: unknown,
          done: (value: unknown) => void,
        ) => Component,
      ) =>
        new Promise<unknown>((resolve) => {
          const component = factory(
            { requestRender: vi.fn() },
            { fg: (_t: string, text: string) => text, bold: (t: string) => t },
            {},
            resolve,
          );
          components.push(component);
        }),
    );
    const ctx = {
      mode: "tui",
      hasUI: true,
      sessionManager: {},
      ui: { select: vi.fn(), input: vi.fn(), custom },
    };
    const pending = askQuestions(
      [{ prompt: "One", mode: "free" }] as never,
      ctx as never,
      { signal: abort.signal },
    );
    await vi.waitFor(() => expect(components.length).toBe(1));
    await type(components[0], "alpha");
    components[0]?.handleInput("\r");

    await vi.waitFor(() => expect(components.length).toBe(2));
    abort.abort();
    const abortedResult = await pending;
    expect(abortedResult?.cancelled).toBe(true);
  });
});
