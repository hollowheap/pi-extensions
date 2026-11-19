import { boxFrame } from "@hollowheap/tui/frame";
import { describe, expect, it, vi } from "vitest";
import { confirmDialog, selectDialog } from "../src/host.js";

function setup() {
  let component:
    | {
        handleInput(data: string): void;
        render(width: number): string[];
      }
    | undefined;
  const theme = {
    fg: (_token: string, value: string) => value,
    bold: (value: string) => value,
  };
  const custom = vi.fn(
    (
      factory: (
        tui: unknown,
        theme: unknown,
        keys: unknown,
        done: (value: unknown) => void,
      ) => NonNullable<typeof component>,
    ) =>
      new Promise((resolve) => {
        component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
      }),
  );
  const ui = {
    custom,
    select: vi.fn(),
    confirm: vi.fn(),
    getEditorText: vi.fn(),
    setEditorText: vi.fn(),
    setEditorComponent: vi.fn(),
  };
  const ctx = { mode: "tui", ui };
  return { ctx, ui, component: () => component, theme };
}

describe("shared prompt overlays", () => {
  it("uses the same thin frame as a panel and keeps the editor untouched", async () => {
    const { ctx, ui, component, theme } = setup();
    const choice = selectDialog(ctx as never, "Select", ["One", "Two"]);
    expect(ui.custom).toHaveBeenCalledWith(expect.any(Function), {
      overlay: true,
      overlayOptions: expect.objectContaining({ anchor: "bottom-center" }),
    });
    const prompt = component()?.render(48);
    const panel = boxFrame(["A panel"], 48, theme as never, "Panel");
    expect(prompt?.[0].slice(0, 2)).toEqual(panel[0].slice(0, 2));
    expect(prompt?.at(-1)).toEqual(panel.at(-1));
    component()?.handleInput("\x1b[B");
    component()?.handleInput("\r");
    await expect(choice).resolves.toBe("Two");
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.getEditorText).not.toHaveBeenCalled();
    expect(ui.setEditorText).not.toHaveBeenCalled();
    expect(ui.setEditorComponent).not.toHaveBeenCalled();
  });

  it("mounts inline in the host prompt slot when overlay is false", async () => {
    const { ctx, ui, component } = setup();
    const choice = selectDialog(ctx as never, "Select", ["One", "Two"], {
      overlay: false,
    });
    expect(ui.custom).toHaveBeenCalledWith(expect.any(Function), {
      overlay: false,
    });
    component()?.handleInput("\r");
    await expect(choice).resolves.toBe("One");
  });

  it("keeps confirmation closed on abort and defaults to No", async () => {
    const { ctx, component } = setup();
    const abort = new AbortController();
    const confirmation = confirmDialog(
      ctx as never,
      "Approve?",
      "Proposed action",
      { signal: abort.signal },
    );
    abort.abort();
    await expect(confirmation).resolves.toBe(false);
    const defaultChoice = confirmDialog(
      ctx as never,
      "Approve?",
      "Proposed action",
    );
    component()?.handleInput("\r");
    await expect(defaultChoice).resolves.toBe(false);
  });

  it("passes RPC prompts and cancellation options to the host", async () => {
    const { ctx, ui } = setup();
    ctx.mode = "rpc";
    ui.select.mockResolvedValue("Original");
    const options = { signal: new AbortController().signal, timeout: 100 };
    await expect(
      selectDialog(ctx as never, "Select", ["Original"], options),
    ).resolves.toBe("Original");
    expect(ui.select).toHaveBeenCalledExactlyOnceWith(
      "Select",
      ["Original"],
      options,
    );
    expect(ui.custom).not.toHaveBeenCalled();
  });
});
