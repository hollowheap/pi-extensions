import { describe, expect, it, vi } from "vitest";
import { askQuestions } from "./index.js";

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

describe("S202 question navigation", () => {
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
    const review = flow.components[2]?.render(80).join("\n") ?? "";
    expect(review).toContain("Review");
    expect(review).toContain("Edit");
    expect(review).toContain("Confirm");
    expect(review).toContain("Cancel");

    const result = await flow.pending;
    expect(result?.[0]).toMatchObject({ mode: "free", value: "alpha" });
    expect(result?.[1]).toMatchObject({ mode: "free", value: "beta" });
  });

  it("returns from a free-text answer to the choice list on the first Escape", async () => {
    const flow = createFlow([{ prompt: "Pick or write", mode: "free" }]);

    await vi.waitFor(() => expect(flow.components.length).toBeGreaterThan(0));
    await type(flow.components[0], "alpha");
    flow.components[0]?.handleInput("\x1b");

    const result = await flow.pending;
    expect(result?.cancelled).not.toBe(true);
    expect(flow.components.length).toBeGreaterThan(1);
  });
});
