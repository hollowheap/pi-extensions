import {
  type Color,
  type Component,
  foregroundAnsi,
  indexedColor,
  rgbColor,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  DEFAULT_TUI_CONFIG,
  type PanelConfig,
  type ToolVerbPack,
} from "@hollowheap/core/tui-config";
import { describe, expect, it, vi } from "vitest";
import {
  formatToolCallSummary,
  formatToolDuration,
  resolveToolVerb,
  stripBackgroundSgr,
  wrapToolRenderer,
} from "../src/panel.js";

function makeConfig(
  overrides: Partial<PanelConfig & { verbPack: ToolVerbPack }> = {},
): PanelConfig & { verbPack: ToolVerbPack } {
  return {
    ...DEFAULT_TUI_CONFIG.panel,
    verbPack: DEFAULT_TUI_CONFIG.verbPack,
    enabled: true,
    ...overrides,
  };
}

const mockTheme = {
  fg: (_token: string, value: string) => value,
  bold: (value: string) => value,
} as never;

const workingTheme = {
  fg: (_token: string, value: string) => value,
  bold: (value: string) => value,
  colors: {
    accent: rgbColor(80, 120, 255),
    borderAccent: rgbColor(80, 220, 255),
    success: rgbColor(80, 220, 120),
    warning: rgbColor(255, 200, 80),
    error: rgbColor(255, 80, 80),
    thinkingText: rgbColor(200, 120, 255),
    text: rgbColor(230, 230, 230),
    muted: rgbColor(120, 120, 120),
  },
  getColorMode: () => "truecolor" as const,
} as never;

function stateTheme(
  stateColors: Record<string, Color>,
  mode: "truecolor" | "256color" = "truecolor",
) {
  return {
    fg: (_token: string, value: string) => value,
    bold: (value: string) => value,
    colors: {
      accent: rgbColor(80, 120, 255),
      borderAccent: rgbColor(80, 220, 255),
      success: rgbColor(80, 220, 120),
      warning: rgbColor(255, 200, 80),
      error: rgbColor(255, 80, 80),
      thinkingText: rgbColor(200, 120, 255),
      text: rgbColor(230, 230, 230),
      muted: rgbColor(120, 120, 120),
      ...stateColors,
    },
    getColorMode: () => mode,
  } as never;
}

function renderCallBox(
  toolName: string,
  isPartial: boolean,
  isError: boolean,
  theme: unknown,
): string[] {
  const renderer = wrapToolRenderer(toolName, undefined, () => makeConfig());
  const comp = renderer.renderCall?.({ command: "echo ok" }, theme as never, {
    args: { command: "echo ok" },
    toolCallId: "state-1",
    invalidate: vi.fn(),
    lastComponent: undefined,
    state: {},
    cwd: "/tmp",
    executionStarted: true,
    argsComplete: true,
    isPartial,
    expanded: false,
    showImages: false,
    isError,
    durationMs: isPartial ? undefined : 10,
    outputPad: 1,
  });
  return comp?.render(50) ?? [];
}

describe("panel verbs and helpers", () => {
  it("resolves standard, terse, and playful verb packs plus unknown $ fallback and custom overrides", () => {
    expect(
      resolveToolVerb("edit", makeConfig({ verbPack: "standard" })),
    ).toEqual({
      active: "Editing...",
      settled: "Edited",
    });
    expect(resolveToolVerb("edit", makeConfig({ verbPack: "terse" }))).toEqual({
      active: "edit...",
      settled: "edit",
    });
    expect(
      resolveToolVerb("edit", makeConfig({ verbPack: "playful" })),
    ).toEqual({
      active: "Sculpting...",
      settled: "Sculpted",
    });
    expect(
      resolveToolVerb("deploy", makeConfig({ verbPack: "standard" })),
    ).toEqual({
      active: "Deploying...",
      settled: "Deployed",
    });
    expect(
      resolveToolVerb(
        "edit",
        makeConfig({
          verbPack: "terse",
          customVerbs: {
            edit: { active: "Patching...", settled: "Patched" },
          },
        }),
      ),
    ).toEqual({ active: "Patching...", settled: "Patched" });
  });

  it("formats durations and argument summaries cleanly", () => {
    expect(formatToolDuration(undefined)).toBeUndefined();
    expect(formatToolDuration(120)).toBe("120ms");
    expect(formatToolDuration(1400)).toBe("1.4s");
    expect(formatToolCallSummary("bash", { command: "git status" })).toBe(
      "git status",
    );
    expect(
      formatToolCallSummary("grep", { pattern: "foo", path: "src/" }),
    ).toBe("foo in src/");
    expect(
      formatToolCallSummary("codemode", { code: "return 1;" }),
    ).toBeUndefined();
  });
});

describe("wrapToolRenderer", () => {
  it("renders bordered box with accent stripe, spinner while pending, and zero leaked timers", () => {
    let clock = 0;
    const cfg = makeConfig({
      borderStyle: "double",
      accentStripe: true,
      reuseSpinner: true,
      verbPack: "playful",
    });
    const renderer = wrapToolRenderer("edit", undefined, () => cfg, {
      now: () => clock,
    });
    expect(renderer.renderShell).toBe("self");

    const state = {};
    const comp = renderer.renderCall?.({ path: "src/app.ts" }, workingTheme, {
      args: { path: "src/app.ts" },
      toolCallId: "t1",
      invalidate: vi.fn(),
      lastComponent: undefined,
      state,
      cwd: "/tmp",
      executionStarted: true,
      argsComplete: true,
      isPartial: true,
      expanded: false,
      showImages: false,
      isError: false,
      durationMs: undefined,
      outputPad: 1,
    });
    if (!comp) throw new Error("expected component");

    const frame0 = comp.render(50);
    expect(frame0[0]?.startsWith("╔")).toBe(true);
    expect(frame0[0]?.endsWith("╗")).toBe(true);
    expect(frame0[2]).toContain("▎");
    expect(frame0[2]).toContain("Sculpting...");
    expect(frame0[2]).toContain("src/app.ts");
    expect(frame0.at(-1)?.startsWith("╚")).toBe(true);
    for (const line of frame0) {
      expect(visibleWidth(line)).toBe(50);
    }

    clock = 150;
    const frame1 = comp.render(50);
    expect(stripTerminalSequences(frame1[2] ?? "")).not.toBe(
      stripTerminalSequences(frame0[2] ?? ""),
    );

    comp.invalidate?.();
    clock = 300;
    const frame2 = comp.render(50);
    expect(stripTerminalSequences(frame2[2] ?? "")).not.toBe(
      stripTerminalSequences(frame1[2] ?? ""),
    );
  });

  it("advances the pending spinner on its own timer", () => {
    vi.useFakeTimers();
    try {
      const cfg = makeConfig({ reuseSpinner: true, accentStripe: false });
      const requestRender = vi.fn();
      const renderer = wrapToolRenderer("bash", undefined, () => cfg, {
        requestRender,
      });
      const context = {
        args: {},
        toolCallId: "t-timer",
        invalidate: vi.fn(),
        lastComponent: undefined,
        state: {},
        cwd: "/tmp",
        executionStarted: true,
        argsComplete: true,
        isPartial: true,
        expanded: false,
        showImages: false,
        isError: false,
        durationMs: undefined,
        outputPad: 1,
      };
      const comp = renderer.renderCall?.({}, workingTheme, context as never);
      if (!comp) throw new Error("expected component");
      const first = comp.render(40);
      vi.advanceTimersByTime(100);
      expect(requestRender).toHaveBeenCalled();
      const second = comp.render(40);
      expect(stripTerminalSequences(second.join("\n"))).not.toBe(
        stripTerminalSequences(first.join("\n")),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("redraws through the tool context without an editor target and clears the timer on dispose", () => {
    vi.useFakeTimers();
    try {
      const cfg = makeConfig({ reuseSpinner: true });
      const contextInvalidate = vi.fn();
      const renderer = wrapToolRenderer("bash", undefined, () => cfg);
      const context = {
        args: {},
        toolCallId: "t-context-redraw",
        invalidate: contextInvalidate,
        lastComponent: undefined,
        state: {},
        cwd: "/tmp",
        executionStarted: true,
        argsComplete: true,
        isPartial: true,
        expanded: false,
        showImages: false,
        isError: false,
        durationMs: undefined,
        outputPad: 1,
      };
      const comp = renderer.renderCall?.({}, workingTheme, context as never);
      if (!comp) throw new Error("expected component");
      comp.render(40);
      expect(contextInvalidate).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(contextInvalidate).toHaveBeenCalled();

      (comp as { dispose?: () => void }).dispose?.();
      contextInvalidate.mockClear();
      vi.advanceTimersByTime(500);
      expect(contextInvalidate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delegates to the base renderer when panel.enabled is false at render time", () => {
    let enabled = true;
    const baseCall = vi.fn(() => ({
      render: () => ["BASE CALL"],
      invalidate: vi.fn(),
    }));
    const baseResult = vi.fn(() => ({
      render: () => ["BASE RESULT"],
      invalidate: vi.fn(),
    }));
    const renderer = wrapToolRenderer(
      "bash",
      { renderCall: baseCall, renderResult: baseResult } as never,
      () => makeConfig({ enabled }),
    );
    const context = {
      args: {},
      toolCallId: "t-disabled",
      invalidate: vi.fn(),
      lastComponent: undefined,
      state: {},
      cwd: "/tmp",
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: false,
      showImages: false,
      isError: false,
      durationMs: 10,
      outputPad: 1,
    };

    const on = renderer.renderCall?.({}, mockTheme, context as never);
    expect(on?.render(40).join("\n")).not.toBe("BASE CALL");
    const callsWhenEnabled = baseCall.mock.calls.length;

    enabled = false;
    const off = renderer.renderCall?.({}, mockTheme, context as never);
    expect(off?.render(40).join("\n")).toBe("BASE CALL");
    expect(baseCall).toHaveBeenCalledTimes(callsWhenEnabled + 1);

    const offResult = renderer.renderResult?.(
      { content: [] } as never,
      { expanded: false, isPartial: false } as never,
      mockTheme,
      context as never,
    );
    expect(offResult?.render(40).join("\n")).toBe("BASE RESULT");
    expect(baseResult).toHaveBeenCalledTimes(1);
  });

  it("renders settled outcome badges and unified call + result box", () => {
    const cfg = makeConfig({
      borderStyle: "rounded",
      accentStripe: true,
      outcomeBadges: true,
    });
    const renderer = wrapToolRenderer("bash", undefined, () => cfg);
    const state = {};
    const context = {
      args: { command: "echo ok" },
      toolCallId: "t2",
      invalidate: vi.fn(),
      lastComponent: undefined,
      state,
      cwd: "/tmp",
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: false,
      showImages: false,
      isError: false,
      durationMs: 1400,
      outputPad: 1,
    };

    const callComp = renderer.renderCall?.(
      { command: "echo ok" },
      mockTheme,
      context,
    );
    const resultComp = renderer.renderResult?.(
      { content: [{ type: "text", text: "ok" }], details: undefined },
      { expanded: false, isPartial: false },
      mockTheme,
      context,
    );
    const lines = [
      ...(callComp?.render(48) ?? []),
      ...(resultComp?.render(48) ?? []),
    ];

    expect(lines[0]?.startsWith("╭")).toBe(true);
    expect(lines[2]).toContain("Ran");
    expect(lines[2]).toContain("✓");
    expect(lines[2]).toContain("1.4s");
    expect(lines[3]).toContain("ok");
    expect(lines.at(-1)?.startsWith("╰")).toBe(true);
    // Only one top and one bottom border for unified call+result box.
    expect(lines.filter((l) => l.startsWith("╭"))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("╰"))).toHaveLength(1);
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(48);
    }
  });

  it("renders error outcome badge and supports none border cleanly", () => {
    const cfg = makeConfig({
      borderStyle: "none",
      accentStripe: false,
      outcomeBadges: true,
    });
    const renderer = wrapToolRenderer("read", undefined, () => cfg);
    const comp = renderer.renderCall?.({ path: "missing.ts" }, mockTheme, {
      args: { path: "missing.ts" },
      toolCallId: "t3",
      invalidate: vi.fn(),
      lastComponent: undefined,
      state: {},
      cwd: "/tmp",
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: false,
      showImages: false,
      isError: true,
      durationMs: 25,
      outputPad: 1,
    });
    const lines = comp?.render(50) ?? [];
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Read");
    expect(lines[1]).toContain("✗");
    expect(lines[1]).toContain("25ms");
    expect(lines[1]).not.toContain("╭");
    expect(lines[1]).not.toContain("▎");
  });

  it("preserves codemode expanded: true when wrapped in panel", () => {
    const baseRenderCall = vi.fn(() => ({
      render: () => ["const x = 1;"],
      invalidate: vi.fn(),
    }));
    const renderer = wrapToolRenderer(
      "codemode",
      { renderCall: baseRenderCall },
      () => makeConfig(),
    );
    const comp = renderer.renderCall?.({ code: "const x = 1;" }, mockTheme, {
      args: { code: "const x = 1;" },
      toolCallId: "t4",
      invalidate: vi.fn(),
      lastComponent: undefined,
      state: {},
      cwd: "/tmp",
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: false,
      showImages: false,
      isError: false,
      durationMs: 12,
      outputPad: 1,
    });
    expect(baseRenderCall).toHaveBeenCalledWith(
      { code: "const x = 1;" },
      mockTheme,
      expect.objectContaining({ expanded: true }),
    );
    const lines = comp?.render(40) ?? [];
    expect(lines.join("\n")).toContain("const x = 1;");
  });

  it("unwraps inner lastComponent across repeated updates and strips redundant host titles", () => {
    const createContainer = () => {
      let items: string[] = [];
      return {
        clear() {
          items = [];
        },
        push(line: string) {
          items.push(line);
        },
        render() {
          return [...items];
        },
        invalidate() {},
      };
    };
    type FakeContainer = ReturnType<typeof createContainer>;

    const renderer = wrapToolRenderer(
      "codemode",
      {
        renderCall(args, _theme, context) {
          const c =
            (context.lastComponent as FakeContainer | undefined) ??
            createContainer();
          c.clear();
          c.push("codemode");
          c.push(String((args as { code?: string }).code ?? ""));
          return c;
        },
        renderResult(result, _options, _theme, context) {
          const c =
            (context.lastComponent as FakeContainer | undefined) ??
            createContainer();
          c.clear();
          c.push("");
          const block = result.content[0] as { text?: string } | undefined;
          c.push(block?.text ?? "");
          c.push("Took 120ms");
          return c;
        },
      },
      () => makeConfig({ borderStyle: "rounded", accentStripe: true }),
    );

    const state = {};
    const makeCtx = (
      lastComponent: Component | undefined,
      isPartial: boolean,
      durationMs?: number,
    ) => ({
      args: { code: "return 42;" },
      toolCallId: "cm-1",
      invalidate: vi.fn(),
      lastComponent,
      state,
      cwd: "/tmp",
      executionStarted: true,
      argsComplete: true,
      isPartial,
      expanded: false,
      showImages: false,
      isError: false,
      durationMs,
      outputPad: 1,
    });

    // Pass 1 (streaming call)
    const call1 = renderer.renderCall?.(
      { code: "return 42;" },
      mockTheme,
      makeCtx(undefined, true),
    );
    expect(call1).toBeDefined();

    // Pass 2 (settled update passes previous wrapper component as lastComponent)
    const call2 = renderer.renderCall?.(
      { code: "return 42;" },
      mockTheme,
      makeCtx(call1, false, 120),
    );
    const res1 = renderer.renderResult?.(
      { content: [{ type: "text", text: "result: 42" }], details: undefined },
      { expanded: false, isPartial: true },
      mockTheme,
      makeCtx(undefined, true),
    );
    const res2 = renderer.renderResult?.(
      { content: [{ type: "text", text: "result: 42" }], details: undefined },
      { expanded: false, isPartial: false },
      mockTheme,
      makeCtx(res1, false, 120),
    );

    const combined = [
      ...(call2?.render(60) ?? []),
      ...(res2?.render(60) ?? []),
    ];
    expect(combined.filter((l) => l.startsWith("╭"))).toHaveLength(1);
    expect(combined.filter((l) => l.startsWith("╰"))).toHaveLength(1);
    const plain = combined.map((l) => stripTerminalSequences(l));
    // Header uses verb badge, redundant inner "codemode" line is omitted
    expect(plain[2]).toContain("Executed");
    expect(plain[2]).toContain("✓");
    expect(plain[2]).toContain("120ms");
    expect(plain.some((l) => /^│▎\s*codemode\s*│$/.test(l))).toBe(false);
    expect(plain.some((l) => l.includes("return 42;"))).toBe(true);
    expect(plain.some((l) => l.includes("result: 42"))).toBe(true);
    expect(plain.at(-3)).toContain("Took 120ms");
  });

  it("applies configured verbPack to nested tool calls rendered inside codemode", () => {
    const base = {
      renderCall: () => ({
        render: () => ["codemode", "read('foo.ts')"],
        invalidate: vi.fn(),
      }),
      renderResult: () => ({
        render: () => ["  ✓ read foo.ts", "  ✗ bash ls"],
        invalidate: vi.fn(),
      }),
    };
    const renderer = wrapToolRenderer("codemode", base, () =>
      makeConfig({ verbPack: "playful" }),
    );
    const state = {};
    const ctx = {
      args: { code: "read('foo.ts')" },
      toolCallId: "cm-verb",
      invalidate: vi.fn(),
      lastComponent: undefined,
      state,
      cwd: "/tmp",
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: false,
      showImages: false,
      isError: false,
      durationMs: 40,
      outputPad: 1,
    };

    const callComp = renderer.renderCall?.(
      { code: "read('foo.ts')" },
      mockTheme,
      ctx,
    );
    const resComp = renderer.renderResult?.(
      { content: [{ type: "text", text: "ok" }], details: {} },
      { expanded: false, isPartial: false },
      mockTheme,
      ctx,
    );
    const combined = [
      ...(callComp?.render(60) ?? []),
      ...(resComp?.render(60) ?? []),
    ].map((l) => stripTerminalSequences(l));
    expect(combined.some((l) => l.includes("Woven"))).toBe(true);
    expect(combined.some((l) => l.includes("✓ Perused foo.ts"))).toBe(true);
    expect(combined.some((l) => l.includes("✗ Conjured ls"))).toBe(true);
  });

  it("reads header error badge consistently from result.isError even when context.isError is false", () => {
    const renderer = wrapToolRenderer("bash", undefined, () => makeConfig());
    const state = {};
    const ctx = {
      args: { command: "false" },
      toolCallId: "t-err",
      invalidate: vi.fn(),
      lastComponent: undefined,
      state,
      cwd: "/tmp",
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: false,
      showImages: false,
      isError: false,
      durationMs: 10,
      outputPad: 1,
    };

    const callComp = renderer.renderCall?.(
      { command: "false" },
      mockTheme,
      ctx,
    );
    const resComp = renderer.renderResult?.(
      {
        content: [{ type: "text", text: "boom" }],
        details: undefined,
        isError: true,
      } as never,
      { expanded: false, isPartial: false },
      mockTheme,
      ctx,
    );

    const lines = [
      ...(callComp?.render(50) ?? []),
      ...(resComp?.render(50) ?? []),
    ];
    expect(lines[2]).toContain("✗");
  });

  it("paints the border and stripe with the pending, success, and error state colors", () => {
    const pendingColor = rgbColor(60, 60, 60);
    const successColor = rgbColor(80, 220, 120);
    const errorColor = rgbColor(255, 80, 80);
    const theme = stateTheme({
      toolPendingBg: pendingColor,
      toolSuccessBg: successColor,
      toolErrorBg: errorColor,
    });

    const pending = renderCallBox("bash", true, false, theme);
    const pendingAnsi = foregroundAnsi(pendingColor, "truecolor");
    expect(pending[0]).toContain(pendingAnsi);
    expect(pending[1]).toContain(pendingAnsi);

    const success = renderCallBox("bash", false, false, theme);
    const successAnsi = foregroundAnsi(successColor, "truecolor");
    expect(success[0]).toContain(successAnsi);
    expect(success[1]).toContain(successAnsi);

    const failed = renderCallBox("bash", false, true, theme);
    const errorAnsi = foregroundAnsi(errorColor, "truecolor");
    expect(failed[0]).toContain(errorAnsi);
    expect(failed[1]).toContain(errorAnsi);
  });

  it("brightens ANSI 8 state colors to their ANSI 16 variants", () => {
    const theme = stateTheme({ toolSuccessBg: indexedColor(2) }, "256color");
    const lines = renderCallBox("bash", false, false, theme);
    const bright = foregroundAnsi(indexedColor(10), "256color");
    expect(lines[0]).toContain(bright);
    expect(lines[0]).not.toContain(foregroundAnsi(indexedColor(2), "256color"));
  });

  it("strips inherited backgrounds from wrapped tool output", () => {
    const base = {
      renderCall: () => ({
        invalidate: vi.fn(),
        render: () => ["\x1b[42mgreen\x1b[49m ok", "\x1b[48;5;236mdark\x1b[0m"],
      }),
    };
    const renderer = wrapToolRenderer("read", base, () => makeConfig());
    const comp = renderer.renderCall?.({ command: "echo ok" }, mockTheme, {
      args: { command: "echo ok" },
      toolCallId: "bg-1",
      invalidate: vi.fn(),
      lastComponent: undefined,
      state: {},
      cwd: "/tmp",
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: false,
      showImages: false,
      isError: false,
      durationMs: 5,
      outputPad: 1,
    });
    const joined = (comp?.render(50) ?? []).join("\n");
    expect(joined).not.toContain("\x1b[42m");
    expect(joined).not.toContain("\x1b[49m");
    expect(joined).not.toContain("\x1b[48;5;236m");
    expect(stripTerminalSequences(joined)).toContain("green ok");
    expect(stripTerminalSequences(joined)).toContain("dark");
  });

  it("paints the full panel surface while preserving rounded borders", () => {
    const base = {
      renderCall: vi.fn(() => ({
        render: () => ["\x1b[31mline 1\x1b[0m"],
        invalidate: () => undefined,
      })),
    };
    const cfg = {
      enabled: true,
      borderStyle: "rounded",
      accentStripe: true,
      outcomeBadges: true,
      reuseSpinner: true,
      customVerbs: {},
      verbPack: "standard",
      surface: "surface",
    } as never;
    const wrapped = wrapToolRenderer("bash", base, () => cfg);
    const theme = {
      fg: (_token: string, text: string) => text,
      bold: (text: string) => text,
      bg: (_token: string, text: string) => `\x1b[44m${text}\x1b[49m`,
    } as never;
    const comp = wrapped.renderCall?.({} as never, theme, {
      outputPad: 0,
    } as never);
    const lines = comp?.render(50) ?? [];
    expect(lines.join("\n")).toContain("╭");
    expect(lines.join("\n")).toContain("╰");
    expect(lines.find((line) => line.includes("line 1"))).toContain(
      "│▎\x1b[31mline 1\x1b[0m\x1b[44m",
    );
    expect(
      lines.every(
        (line) => line.startsWith("\x1b[44m") && line.endsWith("\x1b[49m"),
      ),
    ).toBe(true);

    const paddedComp = wrapped.renderCall?.({} as never, theme, {
      outputPad: 1,
    } as never);
    const paddedLines = paddedComp?.render(50) ?? [];
    expect(paddedLines.find((line) => line.includes("line 1"))).toContain(
      "│▎ \x1b[31mline 1\x1b[0m\x1b[44m",
    );
  });

  it("fills tool calls with a background and no border in background mode", () => {
    const base = {
      renderCall: vi.fn(() => ({
        render: () => ["line 1"],
        invalidate: () => undefined,
      })),
    };
    const cfg = makeConfig({ mode: "background", accentStripe: false });
    const wrapped = wrapToolRenderer("bash", base, () => ({
      ...cfg,
      surface: "surface",
    }));
    const theme = {
      fg: (_token: string, value: string) => value,
      bold: (value: string) => value,
      bg: (_token: string, value: string) => `\x1b[44m${value}\x1b[49m`,
    } as never;
    const comp = wrapped.renderCall?.({} as never, theme, {} as never);
    const joined = (comp?.render(50) ?? []).join("\n");
    expect(joined).toContain("\x1b[44m");
    expect(joined).not.toContain("╭");
    expect(joined).not.toContain("╰");
    expect(stripTerminalSequences(joined)).toContain("line 1");
  });

  it("strips only background SGR parameters and keeps foreground styling", () => {
    expect(stripBackgroundSgr("\x1b[32mok\x1b[39m")).toBe("\x1b[32mok\x1b[39m");
    expect(stripBackgroundSgr("\x1b[1;42mbold\x1b[0m")).toBe(
      "\x1b[1mbold\x1b[0m",
    );
    expect(stripBackgroundSgr("\x1b[mreset")).toBe("\x1b[mreset");
  });

  it("locks header spinner on tall executing boxes and invalidates cache cleanly on config changes", () => {
    let clock = 0;
    let tick = 0;
    let currentCfg = makeConfig({
      borderStyle: "rounded",
      verbPack: "standard",
    });
    const baseRenderer = {
      renderCall: () => ({
        invalidate: vi.fn(),
        render: () => [
          ...Array.from(
            { length: 9 },
            (_, idx) => `\x1b[32mline ${idx + 1}\x1b[39m`,
          ),
          `Elapsed ${tick}s`,
        ],
      }),
    };

    const wrapped = wrapToolRenderer("bash", baseRenderer, () => currentCfg, {
      now: () => clock,
    });
    const sharedState = {};
    const makeCtx = () => ({
      args: { command: "long-cmd" },
      toolCallId: "t-tall",
      invalidate: vi.fn(),
      lastComponent: undefined,
      state: sharedState,
      cwd: "/tmp",
      executionStarted: true,
      argsComplete: true,
      isPartial: true,
      expanded: false,
      showImages: false,
      isError: false,
      durationMs: undefined,
      outputPad: 1,
    });

    const call0 = wrapped.renderCall?.(
      { command: "long-cmd" },
      mockTheme,
      makeCtx(),
    );
    const out0 = call0?.render(50) ?? [];
    expect(out0[3]).toContain("\x1b[32mline 1\x1b[39m\x1b[0m");

    clock = 150;
    tick = 1;
    const call1 = wrapped.renderCall?.(
      { command: "long-cmd" },
      mockTheme,
      makeCtx(),
    );
    const out1 = call1?.render(50) ?? [];
    // Header line stays identical while bottom timer line updates.
    expect(out1[2]).toBe(out0[2]);
    expect(stripTerminalSequences(out1.at(-3) ?? "")).toContain("Elapsed 1s");

    currentCfg = makeConfig({ borderStyle: "none", verbPack: "playful" });
    const out2 = call1?.render(50) ?? [];
    expect(out2[0]?.startsWith("╭")).toBe(false);
    expect(stripTerminalSequences(out2[1] ?? "")).toContain("Conjuring...");
  });
});

describe("tool verbosity", () => {
  const LONG_OUTPUT = Array.from({ length: 14 }, (_, i) => `line-${i}`).join(
    "\n",
  );

  function renderTool(
    toolVerbosity: "low" | "medium" | "high",
    hostExpanded: boolean,
  ) {
    const cfg = { ...makeConfig(), toolVerbosity };
    const renderer = wrapToolRenderer("bash", undefined, () => cfg);
    const state = {};
    const context = {
      args: { command: "echo verbose" },
      toolCallId: "tv-1",
      invalidate: vi.fn(),
      lastComponent: undefined,
      state,
      cwd: "/tmp",
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: hostExpanded,
      showImages: false,
      isError: false,
      durationMs: 5,
      outputPad: 1,
    };
    const call = renderer.renderCall?.(
      { command: "echo verbose" },
      mockTheme,
      context,
    );
    const result = renderer.renderResult?.(
      { content: [{ type: "text", text: LONG_OUTPUT }], details: undefined },
      { expanded: hostExpanded, isPartial: false },
      mockTheme,
      context,
    );
    return {
      call: (call?.render(50) ?? []).map(stripTerminalSequences),
      result: (result?.render(50) ?? []).map(stripTerminalSequences),
    };
  }

  it("low shows only the command and hides all tool output even when the host expands", () => {
    const { call, result } = renderTool("low", true);
    expect(call.join("\n")).toContain("echo verbose");
    expect(result).toEqual([]);
  });

  it("medium shows truncated output even when the host expands", () => {
    const { result } = renderTool("medium", true);
    const joined = result.join("\n");
    expect(joined).toContain("line-0");
    expect(joined).toContain("... (4 more lines)");
    expect(joined).not.toContain("line-13");
  });

  it("high shows full output even when the host collapses", () => {
    const { result } = renderTool("high", false);
    const joined = result.join("\n");
    expect(joined).toContain("line-0");
    expect(joined).toContain("line-13");
    expect(joined).not.toContain("more lines");
  });
});
