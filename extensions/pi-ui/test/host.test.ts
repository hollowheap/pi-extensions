import { boxFrame, getFrameInnerWidth } from "@hollowheap/ui/frame";
import { describe, expect, it, vi } from "vitest";
import {
  confirmDialog,
  frameOverlay,
  overlayTheme,
  selectDialog,
  settledGuard,
} from "../src/host.js";

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

describe("overlay helpers", () => {
  it("reads a live host theme and falls back when absent", () => {
    const fallback = { fg: (_token: string, value: string) => value };
    const first = { fg: (_token: string, value: string) => `first:${value}` };
    const second = { fg: (_token: string, value: string) => `second:${value}` };
    let current: typeof first | undefined = first;
    const ctx = {
      get ui() {
        return current ? { theme: current } : {};
      },
    };
    const getTheme = overlayTheme(ctx as never, fallback as never);

    expect(getTheme()).toBe(first);
    current = second;
    expect(getTheme()).toBe(second);
    current = undefined;
    expect(getTheme()).toBe(fallback);
  });

  it("settles only once", () => {
    const guard = settledGuard();
    expect(guard.isSettled()).toBe(false);
    expect(guard.settle()).toBe(true);
    expect(guard.settle()).toBe(false);
    expect(guard.isSettled()).toBe(true);
  });

  it("renders content at the inner frame width", () => {
    const theme = {
      fg: (_token: string, value: string) => value,
      bold: (value: string) => value,
    };
    const content = vi.fn((width: number) => [`inner:${width}`]);

    const innerWidth = getFrameInnerWidth(30, undefined, 1);
    const framed = frameOverlay(30, theme as never, "Overlay", content);

    expect(content).toHaveBeenCalledWith(innerWidth);
    expect(framed).toEqual(
      boxFrame([`inner:${innerWidth}`], 30, theme as never, "Overlay", {
        paddingX: 1,
        marginX: 0,
      }),
    );
  });
});

describe("shared prompt overlays", () => {
  it("uses the same thin frame as a panel and keeps the editor untouched", async () => {
    const { ctx, ui, component, theme } = setup();
    const choice = selectDialog(ctx as never, "Select", ["One", "Two"]);
    expect(ui.custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ overlay: false }),
    );
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
