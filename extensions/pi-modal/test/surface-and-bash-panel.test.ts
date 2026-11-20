import {
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  UserMessageComponent,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import {
  bindHostOutputPadding,
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/ui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalEditor } from "../src/editor.js";
import {
  installBashPanel,
  installBranchSummaryPanel,
  installCompactionSummaryPanel,
  installCustomMessagePanel,
  installUserMessagePanel,
  markSteeredUserMessage,
} from "../src/skill-panel.js";

function stripCursorMarkers(line: string): string {
  let result = "";
  for (let index = 0; index < line.length; index++) {
    if (line.startsWith("\x1b_pi:", index)) {
      const end = line.indexOf("\x07", index);
      if (end !== -1) {
        index = end;
        continue;
      }
    }
    result += line[index];
  }
  return result;
}

function createEditor(options: {
  borderStyle?: "rounded" | "none";
  initialText?: string;
  modeTheme?: unknown;
}) {
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 24, columns: 80, write: vi.fn() },
  };
  const editorTheme = {
    borderColor: (value: string) => value,
    selectList: {
      selectedPrefix: (value: string) => value,
      selectedText: (value: string) => value,
      description: (value: string) => value,
      scrollInfo: (value: string) => value,
    },
  };
  const editor = new ModalEditor(
    tui as never,
    editorTheme as never,
    { matches: vi.fn(() => false) } as never,
    {
      initialMode: "insert",
      ...(options.borderStyle ? { borderStyle: options.borderStyle } : {}),
    },
    undefined,
    options.modeTheme as never,
  );
  if (options.initialText !== undefined) {
    editor.setText(options.initialText);
  }
  return editor;
}

describe("ModalEditor surface style and symmetric right padding", () => {
  afterEach(() => {
    resetActiveTuiConfig();
  });

  it("adds inner right padding before the right border when bordered", () => {
    const editor = createEditor({
      borderStyle: "rounded",
      initialText: "0123456789ABCDEF",
    });
    const rows = editor.render(20).map(stripCursorMarkers);
    expect(stripTerminalSequences(rows[1] ?? "")).toBe("▎ 0123456789ABCDEF │");
    for (const row of rows) {
      expect(visibleWidth(row)).toBe(20);
    }
  });

  it("preserves border-width space padding in borderless transparent mode", () => {
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "none",
      overlaySurface: "transparent",
    });
    const release = bindHostOutputPadding(() => 1);
    try {
      const editor = createEditor({ initialText: "hello" });
      const rows = editor.render(20).map(stripCursorMarkers);
      expect(stripTerminalSequences(rows[1] ?? "")).toBe(
        "▎ hello             ",
      );
      for (const row of rows) {
        expect(visibleWidth(row)).toBe(20);
      }
    } finally {
      release();
    }
  });

  it("preserves rounded borders and paints every row in surface mode without vertical outputPad rows", () => {
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "rounded",
      overlaySurface: "surface",
      colored: true,
    });
    const modeTheme = {
      fg: (_token: string, value: string) => value,
      bg: (token: string, value: string) => `<bg:${token}>${value}</bg>`,
      getBashModeBorderColor: () => (value: string) => value,
    };
    const release = bindHostOutputPadding(() => 1);
    try {
      const editor = createEditor({
        borderStyle: "rounded",
        initialText: "hello",
        modeTheme,
      });
      const rows = editor.render(20).map(stripCursorMarkers);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.startsWith("<bg:customMessageBg>")).toBe(true);
        expect(row.endsWith("</bg>")).toBe(true);
        const plain = stripTerminalSequences(
          row.replace("<bg:customMessageBg>", "").replace("</bg>", ""),
        );
        expect(visibleWidth(plain)).toBe(20);
      }
      const topPlain = stripTerminalSequences(
        rows[0].replace("<bg:customMessageBg>", "").replace("</bg>", ""),
      );
      expect(topPlain.startsWith("╭")).toBe(true);
      expect(topPlain.endsWith("╮")).toBe(true);
      const contentPlain = stripTerminalSequences(
        rows[1].replace("<bg:customMessageBg>", "").replace("</bg>", ""),
      );
      expect(contentPlain).toBe("▎ hello            │");
      const bottomPlain = stripTerminalSequences(
        rows[2].replace("<bg:customMessageBg>", "").replace("</bg>", ""),
      );
      expect(bottomPlain.startsWith("╰")).toBe(true);
      expect(bottomPlain.endsWith("╯")).toBe(true);
    } finally {
      release();
    }
  });

  it("keeps borders and skips surface paint when colored is false", () => {
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "rounded",
      overlaySurface: "surface",
      colored: false,
    });
    const modeTheme = {
      fg: (_token: string, value: string) => value,
      bg: (token: string, value: string) => `<bg:${token}>${value}</bg>`,
      getBashModeBorderColor: () => (value: string) => value,
    };
    const editor = createEditor({
      borderStyle: "rounded",
      initialText: "hello",
      modeTheme,
    });
    const rows = editor.render(20).map(stripCursorMarkers);
    expect(rows[0]).toContain("╭");
    expect(rows[1]).toContain("│");
    expect(rows[1]).not.toContain("<bg:");
  });

  it("keeps borders in surface mode when modeTheme has no bg helper", () => {
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "rounded",
      overlaySurface: "surface",
      colored: true,
    });
    const editor = createEditor({
      borderStyle: "rounded",
      initialText: "hello",
    });
    const rows = editor.render(20).map(stripCursorMarkers);
    expect(rows[0]).toContain("╭");
    expect(rows[1]).toContain("│");
    expect(rows[2]).toContain("╰");
  });

  it("drops borders consistently and truncates rows at narrow widths", () => {
    const editor = createEditor({
      borderStyle: "rounded",
      initialText: "hello",
    });
    for (const width of [3, 2, 1]) {
      const rows = editor
        .render(width)
        .map(stripCursorMarkers)
        .map(stripTerminalSequences);
      for (const row of rows) {
        expect(row).not.toContain("╭");
        expect(row).not.toContain("│");
        expect(row).not.toContain("╰");
        expect(visibleWidth(row)).toBe(width);
      }
    }
  });
});

describe("installBashPanel", () => {
  afterEach(() => {
    resetActiveTuiConfig();
  });

  it("frames ! and !! BashExecutionComponent instances when panel is enabled and restores host rendering when disabled", () => {
    initTheme();
    const theme = {
      fg: (token: string, value: string) => `[${token}:${value}]`,
      bg: (token: string, value: string) => `<bg:${token}>${value}</bg>`,
      bold: (value: string) => value,
    } as never;

    installBashPanel(() => theme);
    installBashPanel(() => theme);

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      colored: true,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "rounded",
        accentStripe: true,
      },
    });

    const ui = { requestRender: vi.fn() } as never;
    const bang = new BashExecutionComponent("echo hi", ui, false, 1);
    bang.appendOutput("hi");
    bang.setComplete(0, false);

    const bangRaw = bang.render(45);
    expect(bangRaw.some((line) => line.includes("[border:╭"))).toBe(true);
    expect(bangRaw.some((line) => line.includes("[bashMode:"))).toBe(false);
    const bangLines = bangRaw.map(stripTerminalSequences);
    expect(bangLines.some((line) => line.includes("╭"))).toBe(true);
    expect(bangLines.some((line) => line.includes("╰"))).toBe(true);
    expect(bangLines.some((line) => line.includes("$ echo hi"))).toBe(true);
    expect(bangLines.some((line) => line.includes("hi"))).toBe(true);

    const doubleBang = new BashExecutionComponent("pwd", ui, true, 1);
    doubleBang.setComplete(1, false);
    const doubleBangRaw = doubleBang.render(30);
    expect(doubleBangRaw.some((line) => line.includes("[error:"))).toBe(true);
    expect(
      doubleBangRaw
        .map(stripTerminalSequences)
        .some((line) => line.includes("$ pwd")),
    ).toBe(true);

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      overlaySurface: "surface",
      colored: true,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "rounded",
        accentStripe: true,
        surface: "surface",
      },
    });
    bang.invalidate();
    const surfaceRaw = bang.render(60);
    expect(
      surfaceRaw.some((line) => line.includes("<bg:customMessageBg>")),
    ).toBe(true);
    expect(
      surfaceRaw.map(stripTerminalSequences).some((line) => line.includes("╭")),
    ).toBe(true);
    expect(
      surfaceRaw
        .map(stripTerminalSequences)
        .some((line) => line.includes("$ echo hi")),
    ).toBe(true);

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: false,
      },
    });
    bang.invalidate();
    const hostLines = bang.render(30).map(stripTerminalSequences);
    expect(hostLines.some((line) => line.includes("╭"))).toBe(false);
    expect(hostLines.some((line) => line.startsWith("─"))).toBe(true);

    // Toggling panel.enabled back on re-frames the component automatically on render
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "rounded",
      },
    });
    const reFramedLines = bang.render(30).map(stripTerminalSequences);
    expect(reFramedLines.some((line) => line.includes("╭"))).toBe(true);

    // !! (excludeFromContext = true) redraws with surface + border and avoids dim header on surface
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      overlaySurface: "surface",
      colored: true,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "rounded",
        surface: "surface",
      },
    });
    const doubleBangSurface = new BashExecutionComponent(
      "echo secret",
      ui,
      true,
      1,
    );
    doubleBangSurface.appendOutput("secret");
    doubleBangSurface.setComplete(0, false);
    const doubleBangSurfaceRaw = doubleBangSurface.render(60);
    expect(
      doubleBangSurfaceRaw.some((line) => line.includes("[borderAccent:╭")),
    ).toBe(true);
    expect(
      doubleBangSurfaceRaw.some((line) =>
        line.includes("<bg:customMessageBg>"),
      ),
    ).toBe(true);
    expect(
      doubleBangSurfaceRaw
        .map(stripTerminalSequences)
        .some((line) => line.includes("╭")),
    ).toBe(true);
    expect(
      doubleBangSurfaceRaw
        .map(stripTerminalSequences)
        .some((line) => line.includes("$ echo secret")),
    ).toBe(true);
  });

  it("aligns running loader without double-padding and avoids double-padding in collapsed !expanded state", () => {
    initTheme();
    const theme = {
      fg: (_token: string, value: string) => value,
      bg: (token: string, value: string) => `<bg:${token}>${value}</bg>`,
      bold: (value: string) => value,
    } as never;

    installBashPanel(() => theme);
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      colored: true,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "rounded",
        accentStripe: true,
      },
    });

    const ui = { requestRender: vi.fn() } as never;
    const running = new BashExecutionComponent("sleep 1", ui, false, 1);
    try {
      const runningLines = running.render(34).map(stripTerminalSequences);
      const cmdLine = runningLines.find((line) => line.includes("$ sleep 1"));
      const loaderLine = runningLines.find((line) =>
        line.includes("Running..."),
      );
      expect(cmdLine).toBeDefined();
      expect(loaderLine).toBeDefined();
      expect(cmdLine?.startsWith("│▎ $ sleep 1")).toBe(true);
      expect(loaderLine?.startsWith("│▎ ")).toBe(true);
      expect(loaderLine?.startsWith("│▎  ")).toBe(false);

      // Disable panel without calling updateDisplay; render() must restore host children and loader paddingX=1
      setActiveTuiConfig({
        ...DEFAULT_TUI_CONFIG,
        panel: {
          ...DEFAULT_TUI_CONFIG.panel,
          enabled: false,
        },
      });
      const restoredLines = running.render(34).map(stripTerminalSequences);
      expect(restoredLines.some((line) => line.includes("╭"))).toBe(false);
      expect(restoredLines.some((line) => line.startsWith("─"))).toBe(true);
      const restoredLoader = restoredLines.find((line) =>
        line.includes("Running..."),
      );
      expect(restoredLoader?.startsWith(" ")).toBe(true);
    } finally {
      running.setComplete(0, false);
    }

    // Re-enable panel and test collapsed (!expanded) multi-line output
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      colored: true,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "rounded",
        accentStripe: true,
      },
    });
    const collapsed = new BashExecutionComponent("seq 1 10", ui, false, 1);
    collapsed.appendOutput(
      Array.from({ length: 10 }, (_, idx) => `line-${idx + 1}`).join("\n"),
    );
    collapsed.setComplete(0, false);
    const collapsedLines = collapsed.render(34).map(stripTerminalSequences);
    const seqCmdLine = collapsedLines.find((line) =>
      line.includes("$ seq 1 10"),
    );
    const outLine = collapsedLines.find((line) => line.includes("line-10"));
    expect(seqCmdLine?.startsWith("│▎ $ seq 1 10")).toBe(true);
    expect(outLine?.startsWith("│▎ line-10")).toBe(true);
    expect(outLine?.startsWith("│▎  line-10")).toBe(false);
  });
});

describe("ModalEditor shared panel.borderStyle and unified chat panels", () => {
  afterEach(() => {
    resetActiveTuiConfig();
  });

  it("shares panel.borderStyle and panel surface with ModalEditor when explicitBorderStyle is not set", () => {
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        borderStyle: "double",
      },
    });
    const editor = createEditor({ initialText: "shared style" });
    const doubleRows = editor
      .render(30)
      .map(stripCursorMarkers)
      .map(stripTerminalSequences);
    expect(doubleRows[0]?.startsWith("╔")).toBe(true);
    expect(doubleRows[1]?.startsWith("▎ shared style")).toBe(true);
    expect(doubleRows[2]?.startsWith("╚")).toBe(true);

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        style: "square",
        borderStyle: "square",
      },
    });
    const squareRows = editor
      .render(30)
      .map(stripCursorMarkers)
      .map(stripTerminalSequences);
    expect(squareRows[0]?.startsWith("┌")).toBe(true);
    expect(squareRows[2]?.startsWith("└")).toBe(true);

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        borderStyle: "none",
        surface: "surface",
      },
    });
    const bgRows = editor
      .render(30)
      .map(stripCursorMarkers)
      .map(stripTerminalSequences);
    expect(bgRows[0]).not.toContain("╭");
    expect(bgRows[0]).not.toContain("┌");
  });

  it("renders UserMessageComponent with prompt cutout, inner outputPad, OSC133 zones, and Prompted vs Steered verb packs", () => {
    initTheme();
    const theme = {
      fg: (_token: string, value: string) => value,
      bg: (token: string, value: string) => `<bg:${token}>${value}</bg>`,
      bold: (value: string) => value,
    } as never;

    let promptChar = "❯";
    installUserMessagePanel(
      () => theme,
      () => promptChar,
    );

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      verbPack: "standard",
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "rounded",
        accentStripe: false,
      },
    });

    const userMsg = new UserMessageComponent(
      "Hello world\nSecond line",
      undefined,
      1,
    );
    const rawLines = userMsg.render(34);
    expect(rawLines[0]?.startsWith("\x1b]133;A\x07")).toBe(true);
    expect(rawLines.at(-1)?.startsWith("\x1b]133;B\x07\x1b]133;C\x07")).toBe(
      true,
    );
    const plainLines = rawLines.map(stripTerminalSequences);
    expect(plainLines[0]).toBe(`╭${"─".repeat(32)}╮`);
    expect(plainLines[1]?.startsWith("❯ Hello world")).toBe(true);
    expect(plainLines[1]?.endsWith(" │")).toBe(true);
    expect(plainLines[2]?.startsWith("│ Second line")).toBe(true);
    expect(plainLines.at(-1)).toContain(" Prompted ─╯");

    // Steered via markSteeredUserMessage + playful verb pack
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      verbPack: "playful",
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "square",
        accentStripe: false,
      },
    });
    promptChar = "»";
    markSteeredUserMessage("Steer me now");
    const steeredMsg = new UserMessageComponent("Steer me now", undefined, 1);
    const steeredPlain = steeredMsg.render(34).map(stripTerminalSequences);
    expect(steeredPlain[0]?.startsWith("┌")).toBe(true);
    expect(steeredPlain[1]?.startsWith("» Steer me now")).toBe(true);
    expect(steeredPlain.at(-1)).toContain(" Nudged ─┘");

    // Terse verb pack for both prompt and steered property
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      verbPack: "terse",
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "rounded",
        accentStripe: false,
      },
    });
    const tersePromptPlain = userMsg.render(34).map(stripTerminalSequences);
    expect(tersePromptPlain.at(-1)).toContain(" prompt ─╯");
    const terseSteerPlain = steeredMsg.render(34).map(stripTerminalSequences);
    expect(terseSteerPlain.at(-1)).toContain(" steer ─╯");

    // Restores original host UserMessageComponent rendering when !panel.enabled
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: false,
      },
    });
    const disabledPlain = userMsg.render(34).map(stripTerminalSequences);
    expect(disabledPlain.some((l) => l.includes("╭"))).toBe(false);
    expect(disabledPlain.some((l) => l.includes("Hello world"))).toBe(true);
  });

  it("frames BranchSummaryMessageComponent, CompactionSummaryMessageComponent, and CustomMessageComponent with outputPad inside the border", () => {
    initTheme();
    const theme = {
      fg: (_token: string, value: string) => value,
      bg: (token: string, value: string) => `<bg:${token}>${value}</bg>`,
      bold: (value: string) => value,
    } as never;

    installBranchSummaryPanel(() => theme);
    installCompactionSummaryPanel(() => theme);
    installCustomMessagePanel(() => theme);

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "square",
        accentStripe: false,
      },
    });

    const branch = new BranchSummaryMessageComponent(
      { summary: "Switched branch details" } as never,
      undefined,
      1,
    );
    const branchCollapsed = branch.render(44).map(stripTerminalSequences);
    expect(branchCollapsed[0]).toBe(`┌${"─".repeat(42)}┐`);
    expect(branchCollapsed[1]?.startsWith("│ [branch]")).toBe(true);
    expect(branchCollapsed.some((l) => l.includes("│ Branch summary ("))).toBe(
      true,
    );
    expect(branchCollapsed.at(-1)).toBe(`└${"─".repeat(42)}┘`);

    branch.setExpanded(true);
    const branchExpanded = branch.render(44).map(stripTerminalSequences);
    expect(
      branchExpanded.some((l) => l.includes("Switched branch details")),
    ).toBe(true);

    const compaction = new CompactionSummaryMessageComponent(
      { summary: "Compacted history summary", tokensBefore: 12345 } as never,
      undefined,
      1,
    );
    const compactionCollapsed = compaction
      .render(44)
      .map(stripTerminalSequences);
    expect(compactionCollapsed[0]).toBe(`┌${"─".repeat(42)}┐`);
    expect(compactionCollapsed[1]?.startsWith("│ [compaction]")).toBe(true);
    expect(compactionCollapsed.some((l) => l.includes("Compacted from"))).toBe(
      true,
    );
    expect(compactionCollapsed.at(-1)).toBe(`└${"─".repeat(42)}┘`);

    compaction.setExpanded(true);
    const compactionExpanded = compaction
      .render(44)
      .map(stripTerminalSequences);
    expect(
      compactionExpanded.some((l) => l.includes("Compacted history summary")),
    ).toBe(true);

    const custom = new CustomMessageComponent(
      {
        role: "custom",
        customType: "notice",
        content: "Custom extension body",
        display: true,
      } as never,
      undefined,
      undefined,
      1,
    );
    const customLines = custom
      .render(44)
      .map(stripTerminalSequences)
      .filter((l) => l.trim().length > 0);
    expect(customLines[0]).toBe(`┌${"─".repeat(42)}┐`);
    expect(customLines[1]?.startsWith("│ [notice]")).toBe(true);
    expect(
      customLines.some((l) => l.startsWith("│ Custom extension body")),
    ).toBe(true);
    expect(customLines.at(-1)).toBe(`└${"─".repeat(42)}┘`);
  });

  it("hides and shows the ModalEditor mode indicator when modeIndicator is toggled", () => {
    const mockTheme = {
      fg: (_token: string, text: string) => text,
      bg: (_token: string, text: string) => text,
      bold: (text: string) => text,
      getBashModeBorderColor: () => (text: string) => text,
    } as never;
    const editor = new ModalEditor(
      {
        requestRender: vi.fn(),
        terminal: { rows: 24, columns: 80 },
      } as never,
      { borderColor: (text: string) => text, selectList: {} } as never,
      { matches: () => false } as never,
      { enabled: true, initialMode: "normal", promptChar: "❯" },
      undefined,
      mockTheme,
    );

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      modeIndicator: true,
    });
    const shown = editor.render(40).map(stripTerminalSequences).join("\n");
    expect(shown).toContain("NORMAL");

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      modeIndicator: false,
    });
    editor.invalidate();
    const hidden = editor.render(40).map(stripTerminalSequences).join("\n");
    expect(hidden).not.toContain("NORMAL");
  });
});
