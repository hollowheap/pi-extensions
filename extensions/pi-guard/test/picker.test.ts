import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { describe, expect, it, vi } from "vitest";
import { showGrantPicker as show } from "../src/commands.js";

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
};

function pickerContext() {
  let component:
    | {
        render(width: number): string[];
        handleInput(data: string): void;
        dispose?(): void;
      }
    | undefined;
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      custom: vi.fn(
        (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: (value: string | undefined) => void,
          ) => {
            render(width: number): string[];
            handleInput(data: string): void;
          },
        ) =>
          new Promise<string | undefined>((resolve) => {
            component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
          }),
      ),
    },
  };
  return { ctx, component: () => component };
}

describe("show", () => {
  it("fuzzy filters recent permission targets", async () => {
    const env = pickerContext();
    const result = show(env.ctx as never, ["src/a.ts", "artifacts/plan.md"]);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    const component = env.component();
    expect(component?.render(60).join("\n")).toContain("src/a.ts");
    for (const key of "plan") component?.handleInput(key);
    expect(component?.render(60).join("\n")).not.toContain("src/a.ts");
    component?.handleInput("\r");

    await expect(result).resolves.toBe("artifacts/plan.md");
  });

  it("returns undefined when cancelled", async () => {
    const env = pickerContext();
    const result = show(env.ctx as never, ["src/a.ts"]);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    env.component()?.handleInput("\x1b");
    await expect(result).resolves.toBeUndefined();
  });

  it("settles and releases the prompt lock when disposed without input", async () => {
    const env = pickerContext();
    const result = show(env.ctx as never, ["src/a.ts"]);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    expect(env.component()?.dispose).toBeTypeOf("function");
    env.component()?.dispose?.();
    await expect(result).resolves.toBeUndefined();
    await expect(withPromptLock(async () => "next")).resolves.toBe("next");
  });
});
