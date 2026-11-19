import { describe, expect, it, vi } from "vitest";
import { askQuestions } from "../src/index.js";

interface Component {
  render(width: number): string[];
  handleInput(data: string): void;
}

function createFlow(questions: Array<{ prompt: string; mode: "free" }>) {
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
    await type(flow.components[0], "alpha");
    flow.components[0]?.handleInput("\r");

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(1));
    await type(flow.components[1], "beta");
    flow.components[1]?.handleInput("\r");

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(2));
    const review = flow.components[2];
    if (review === undefined) throw new Error("missing review component");
    const rendered = review.render(80).join("\n");
    expect(rendered).toContain("Review");
    expect(rendered).toContain("Edit");
    expect(rendered).toContain("Confirm");
    expect(rendered).toContain("Cancel");

    review.handleInput("\r");
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
    await type(flow.components[0], "alpha");
    flow.components[0]?.handleInput("\r");

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(1));
    await type(flow.components[1], "beta");
    flow.components[1]?.handleInput("\r");

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(2));
    const review = flow.components[2];
    if (review === undefined) throw new Error("missing review component");
    review.handleInput("\x1b[D");
    review.handleInput("\r");

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(3));
    const edit = flow.components[3];
    if (edit === undefined) throw new Error("missing edit component");
    await type(edit, "ALPHA");
    edit.handleInput("\r");

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(4));
    const reviewAgain = flow.components[4];
    if (reviewAgain === undefined)
      throw new Error("missing repeated review component");
    expect(reviewAgain.render(80).join("\n")).toContain("ALPHA");
    reviewAgain.handleInput("\r");

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
    await type(flow.components[0], "alpha");
    flow.components[0]?.handleInput("\r");
    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(1));
    await type(flow.components[1], "beta");
    flow.components[1]?.handleInput("\r");
    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(2));
    const review = flow.components[2];
    if (review === undefined) throw new Error("missing review component");
    review.handleInput("\x1b[D");
    review.handleInput("\x1b[C");
    review.handleInput("\r");

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
});
