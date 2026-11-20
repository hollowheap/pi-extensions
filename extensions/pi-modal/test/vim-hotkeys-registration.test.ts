import { InteractiveMode, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences } from "@earendil-works/pi-tui";
import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import {
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/tui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";
import {
  formatVimHotkeysMarkdown,
  formatVimKeys,
  installHotkeysPanel,
} from "../src/vimkeys.js";

function createMockPi() {
  return {
    on: vi.fn(() => () => {}),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerToolRenderer: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
  };
}

afterEach(() => {
  resetActiveTuiConfig();
});

describe("vim keybind reference registration", () => {
  it("does not register a standalone vim keybind command", () => {
    const pi = createMockPi();
    extension(pi as never);

    const names = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(names).not.toContain("vimkeys");
  });

  it("does not expose a separate vim keybind command surface", () => {
    const pi = createMockPi();
    extension(pi as never);

    const vimCommands = pi.registerCommand.mock.calls.filter(([, def]) =>
      /vim/i.test(
        (def as { description?: string } | undefined)?.description ?? "",
      ),
    );
    expect(vimCommands).toHaveLength(0);
  });

  it("no other keybind command surface is registered", () => {
    const pi = createMockPi();
    extension(pi as never);

    const names = pi.registerCommand.mock.calls.map(([name]) => name);
    for (const legacy of ["keys", "keybinds", "binds", "vim"]) {
      expect(names).not.toContain(legacy);
    }
  });

  it("registers no separate shortcut popup and contributes vim keybinds to the host /hotkeys section", () => {
    initTheme();
    const pi = createMockPi();
    extension(pi as never);

    const shortcuts = pi.registerShortcut.mock.calls.map(([name]) => name);
    expect(shortcuts).toEqual(["ctrl+o", "ctrl+t"]);

    installHotkeysPanel(
      () => undefined,
      () => ({
        enabled: true,
        keymaps: { insert: { jk: null } },
      }),
    );

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "rounded",
        accentStripe: false,
      },
    });

    const chatContainer = new Container();
    const fakeHost = {
      chatContainer,
      outputPad: 1,
      getEditorKeyDisplay: (action: string) => action,
      getAppKeyDisplay: (action: string) => action,
      getMarkdownThemeWithSettings: () => ({
        heading: (t: string) => t,
        link: (t: string) => t,
        linkUrl: (t: string) => t,
        code: (t: string) => t,
        codeBlock: (t: string) => t,
        codeBlockBorder: (t: string) => t,
        quote: (t: string) => t,
        quoteBorder: (t: string) => t,
        hr: (t: string) => t,
        listBullet: (t: string) => t,
        bold: (t: string) => t,
        italic: (t: string) => t,
        strikethrough: (t: string) => t,
        underline: (t: string) => t,
        highlightCode: (code: string) => code.split("\n"),
      }),
      keybindings: {
        getEffectiveConfig: () => ({}),
      },
      session: {
        extensionRunner: {
          getShortcuts: () => new Map(),
        },
      },
      ui: {
        requestRender: vi.fn(),
      },
    };

    const handleHotkeysCommand = Reflect.get(
      InteractiveMode.prototype,
      "handleHotkeysCommand",
    ) as (this: unknown) => void;
    handleHotkeysCommand.call(fakeHost);
    const rendered = stripTerminalSequences(
      chatContainer.render(80).join("\n"),
    );
    expect(rendered).toContain("Keyboard Shortcuts");
    expect(rendered).toContain("Vim Mode (pi-modal)");
    expect(rendered).toContain("Normal: move left");
    expect(rendered).toContain("Insert: normal mode");
    expect(rendered).toContain("jk");
    expect(rendered).toContain("╭");
    expect(rendered).toContain("╰");
  });

  it("the reference is rendered from the shared keymap", () => {
    const reference = formatVimKeys();

    expect(reference).toContain("pi-modal vim keybinds");
    for (const section of [
      "Normal mode",
      "Insert mode",
      "Visual mode",
      "Command mode",
      "Search mode",
    ]) {
      expect(reference).toContain(section);
    }
    expect(reference).toContain("delete line");
    expect(reference).toContain("move left");

    const md = formatVimHotkeysMarkdown({ keymaps: { insert: { jk: null } } });
    expect(md).toContain("**Vim Mode (pi-modal)**");
    expect(md).toContain("| `jk` | Insert: normal mode |");
  });
});
