import {
  type Component,
  rgbColor,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  DEFAULT_TUI_CONFIG,
  type ToolBoxConfig,
} from "@hollowheap/core/tui-config";
import { describe, expect, it, vi } from "vitest";
import {
  formatToolCallSummary,
  formatToolDuration,
  resolveToolVerb,
  wrapToolRenderer,
} from "./tool-box.js";

function makeConfig(overrides: Partial<ToolBoxConfig> = {}): ToolBoxConfig {
  return {
    ...DEFAULT_TUI_CONFIG.toolBox,
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

describe("tool-box verbs and helpers", () => {
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
    expect(frame0[1]).toContain("▎");
    expect(frame0[1]).toContain("Sculpting...");
    expect(frame0[1]).toContain("src/app.ts");
    expect(frame0.at(-1)?.startsWith("╚")).toBe(true);
    for (const line of frame0) {
      expect(visibleWidth(line)).toBe(50);
    }

    clock = 150;
    const frame1 = comp.render(50);
    expect(stripTerminalSequences(frame1[1] ?? "")).not.toBe(
      stripTerminalSequences(frame0[1] ?? ""),
    );
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
    expect(lines[1]).toContain("Ran");
    expect(lines[1]).toContain("✓");
    expect(lines[1]).toContain("1.4s");
    expect(lines[2]).toContain("ok");
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
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Read");
    expect(lines[0]).toContain("✗");
    expect(lines[0]).toContain("25ms");
    expect(lines[0]).not.toContain("╭");
    expect(lines[0]).not.toContain("▎");
  });

  it("preserves codemode expanded: true when wrapped in tool-box", () => {
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
    expect(plain[1]).toContain("Executed");
    expect(plain[1]).toContain("✓");
    expect(plain[1]).toContain("120ms");
    expect(plain.some((l) => /^│▎\s*codemode\s*│$/.test(l))).toBe(false);
    expect(plain.some((l) => l.includes("return 42;"))).toBe(true);
    expect(plain.some((l) => l.includes("result: 42"))).toBe(true);
    expect(plain.at(-2)).toContain("Took 120ms");
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
    expect(lines[1]).toContain("✗");
  });
});
