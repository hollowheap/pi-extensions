import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSessionSnapshot } from "@hollowheap/core/snapshot";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";
import {
  WEB_HISTORY_TYPE,
  createWebFetchTool,
  createWebSearchTool,
  getWebSessionState,
  rememberWebLinks,
} from "../src/tools.js";

const state = vi.hoisted(() => ({
  agentDir: "",
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    getAgentDir: () => state.agentDir || actual.getAgentDir(),
  };
});

const tempDirs: string[] = [];
afterEach(() => {
  state.agentDir = "";
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createMockPi() {
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
    {};
  return {
    on: vi.fn(
      (event: string, fn: (event: unknown, ctx: unknown) => unknown) => {
        handlers[event] = fn;
        return () => {};
      },
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    getAllTools: vi.fn((): Array<{ name: string }> => []),
    getActiveTools: vi.fn((): string[] => []),
    setActiveTools: vi.fn(),
    handlers,
  };
}

describe("rememberWebLinks", () => {
  afterEach(() => {
    // Reset lastActiveWebState to avoid polluting other tests.
    getWebSessionState({});
  });
  it("dedupes and caps at 20", () => {
    const owner = {};
    const links = Array.from({ length: 25 }, (_, i) => ({
      url: `https://example.com/${i}`,
    }));
    rememberWebLinks(links, owner);
    const state = getWebSessionState(owner);
    expect(state.urls.length).toBe(20);
    expect(new Set(state.urls).size).toBe(20);
  });
  it("filters non-http urls", () => {
    const owner = {};
    rememberWebLinks(
      [
        { url: "https://example.com/a" },
        { url: "ftp://example.com/b" },
        { url: "https://example.com/a" },
      ],
      owner,
    );
    const state = getWebSessionState(owner);
    expect(state.urls).toEqual(["https://example.com/a"]);
  });
});

describe("pi-web extension", () => {
  it("inserts a recent result link into the editor", async () => {
    const pi = createMockPi();
    extension(pi as never);
    rememberWebLinks([
      { url: "https://example.com/a" },
      { url: "https://example.com/b" },
    ]);
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
      getArgumentCompletions?: (
        prefix: string,
      ) => Array<{ value: string; label: string; description?: string }> | null;
    };
    const pasteToEditor = vi.fn();
    const notify = vi.fn();

    await command.handler("insert 2", {
      hasUI: true,
      mode: "tui",
      ui: { pasteToEditor, notify, custom: vi.fn() },
    });

    expect(pasteToEditor).toHaveBeenCalledWith("https://example.com/b");
    expect(notify).toHaveBeenCalledWith(
      "Inserted https://example.com/b",
      "info",
    );
    expect(
      (command.getArgumentCompletions?.("insert 2") ?? []).map(
        (item) => item.value,
      ),
    ).toEqual(["2"]);
  });

  it("activates codemode when it is registered and inactive", () => {
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["read"]);
    extension(pi as never);

    pi.handlers.session_start?.({}, {});
    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "codemode"]);
  });

  it("removes web_search and web_fetch from the active tool set", () => {
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue([
      "read",
      "web_search",
      "web_fetch",
      "codemode",
    ]);
    extension(pi as never);

    pi.handlers.session_start?.({}, {});
    expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "codemode"]);
  });

  it("removes direct web tools even when codemode is unavailable", () => {
    const pi = createMockPi();
    pi.getActiveTools.mockReturnValue(["read", "web_search"]);
    extension(pi as never);

    pi.handlers.session_start?.({}, {});
    expect(pi.setActiveTools).toHaveBeenCalledWith(["read"]);
  });

  it("does not duplicate an already-active codemode", () => {
    const pi = createMockPi();
    pi.getAllTools.mockReturnValue([{ name: "codemode" }]);
    pi.getActiveTools.mockReturnValue(["codemode"]);
    extension(pi as never);

    pi.handlers.session_start?.({}, {});
    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });

  it("does not add codemode when it is not registered", () => {
    const pi = createMockPi();
    extension(pi as never);

    pi.handlers.session_start?.({}, {});
    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });

  it("registers exactly two codemode tools", () => {
    const pi = createMockPi();
    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(2);
    const names = pi.registerTool.mock.calls.map(
      ([tool]) => (tool as { name: string }).name,
    );
    expect(names).toEqual(["web_search", "web_fetch"]);
    for (const [tool] of pi.registerTool.mock.calls) {
      expect((tool as { exposure: string }).exposure).toBe("codemode");
    }
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "web",
      expect.objectContaining({ handler: expect.any(Function) }),
    );
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.setActiveTools).not.toHaveBeenCalled();

    const search = pi.registerTool.mock.calls[0][0] as {
      parameters: { properties?: Record<string, unknown> };
    };
    const fetch = pi.registerTool.mock.calls[1][0] as {
      parameters: { properties?: Record<string, unknown> };
    };
    expect(search.parameters.properties).toHaveProperty("query");
    expect(fetch.parameters.properties).toHaveProperty("url");
  });

  it("persists WEB_HISTORY_TYPE on web_search/web_fetch and publishes snapshot", async () => {
    const pi = createMockPi();
    const searchTool = createWebSearchTool(
      {
        search: vi.fn().mockResolvedValue([
          {
            title: "Result",
            url: "https://example.com/item",
            snippet: "Snippet",
          },
        ]),
      },
      pi as never,
    );
    const sessionManager = { getBranch: vi.fn(() => []) };
    const ctx = { sessionManager };

    await searchTool.execute(
      "call-1",
      { query: "search test" },
      undefined,
      undefined,
      ctx as never,
    );

    expect(pi.appendEntry).toHaveBeenCalledWith(
      WEB_HISTORY_TYPE,
      expect.objectContaining({
        urls: ["https://example.com/item"],
        searchCount: 1,
        fetchCount: 0,
      }),
    );

    let snap = getSessionSnapshot(sessionManager);
    expect(snap.web).toMatchObject({
      searchCount: 1,
      fetchCount: 0,
      recentUrls: ["https://example.com/item"],
    });

    const fetchTool = createWebFetchTool(
      {
        fetch: vi.fn().mockResolvedValue({
          url: "https://example.com/fetched",
          content: "Content",
          links: [],
          media: [],
          truncated: false,
        }),
      },
      pi as never,
    );

    await fetchTool.execute(
      "call-2",
      { url: "https://example.com/fetched" },
      undefined,
      undefined,
      ctx as never,
    );

    expect(pi.appendEntry).toHaveBeenCalledWith(
      WEB_HISTORY_TYPE,
      expect.objectContaining({
        urls: expect.arrayContaining([
          "https://example.com/fetched",
          "https://example.com/item",
        ]),
        searchCount: 1,
        fetchCount: 1,
      }),
    );

    snap = getSessionSnapshot(sessionManager);
    expect(snap.web).toMatchObject({
      searchCount: 1,
      fetchCount: 1,
    });
  });

  it("restores web state on session_start / session_tree and re-appends on session_compact", async () => {
    const pi = createMockPi();
    extension(pi as never);

    const sessionManager = {
      getBranch: vi.fn(() => [
        {
          type: "custom",
          customType: WEB_HISTORY_TYPE,
          data: {
            urls: ["https://example.com/old"],
            searchCount: 3,
            fetchCount: 2,
            updatedAt: 5000,
          },
        },
      ]),
    };
    const ctx = { sessionManager };

    pi.handlers.session_start?.({}, ctx);

    let snap = getSessionSnapshot(sessionManager);
    expect(snap.web).toMatchObject({
      searchCount: 3,
      fetchCount: 2,
      recentUrls: ["https://example.com/old"],
      updatedAt: 5000,
    });

    pi.handlers.session_tree?.({}, ctx);
    snap = getSessionSnapshot(sessionManager);
    expect(snap.web).toMatchObject({
      searchCount: 3,
      fetchCount: 2,
      recentUrls: ["https://example.com/old"],
    });

    pi.appendEntry.mockClear();
    pi.handlers.session_compact?.({}, ctx);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      WEB_HISTORY_TYPE,
      expect.objectContaining({
        urls: ["https://example.com/old"],
        searchCount: 3,
        fetchCount: 2,
      }),
    );
  });

  it("supports /web settings and config alias with completions and OS permission errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-web-idx-"));
    tempDirs.push(dir);
    state.agentDir = dir;

    const pi = createMockPi();
    extension(pi as never);
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
      getArgumentCompletions?: (
        prefix: string,
      ) => Array<{ value: string; label: string; description?: string }> | null;
    };

    expect(
      (command.getArgumentCompletions?.("") ?? []).map((item) => item.value),
    ).toEqual(["settings", "config", "insert"]);
    expect(
      (command.getArgumentCompletions?.("co") ?? []).map((item) => item.value),
    ).toEqual(["config"]);

    let component:
      | { handleInput(data: string): void; render(width: number): string[] }
      | undefined;
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: () => void,
        ) => {
          handleInput(data: string): void;
          render(width: number): string[];
        },
      ) =>
        new Promise<void>((resolve) => {
          component = factory(
            { requestRender: vi.fn() },
            { fg: (_t: string, s: string) => s, bold: (s: string) => s },
            {},
            resolve,
          );
        }),
    );
    const notify = vi.fn();
    const pending = command.handler("config", {
      hasUI: true,
      mode: "tui",
      ui: { pasteToEditor: vi.fn(), notify, custom },
    });
    await vi.waitFor(() => expect(component).toBeDefined());
    expect(component?.render(80).join("\n")).toContain("Web settings");
    component?.handleInput("\x1b");
    await pending;
    expect(custom).toHaveBeenCalledTimes(1);

    // Trigger write failure notification via invalid JSON
    writeFileSync(join(dir, "web.json"), "{bad");
    component = undefined;
    const getComponent = () => component;
    const errNotify = vi.fn();
    const errPending = command.handler("config", {
      hasUI: true,
      mode: "tui",
      ui: { pasteToEditor: vi.fn(), notify: errNotify, custom },
    });
    await vi.waitFor(() => expect(getComponent()).toBeDefined());
    getComponent()?.handleInput("\r");
    getComponent()?.handleInput("\x1b");
    await errPending;
    expect(errNotify).toHaveBeenCalledWith(
      expect.stringContaining("failed to save settings"),
      "error",
    );

    if (process.getuid?.() !== 0) {
      const permDir = mkdtempSync(join(tmpdir(), "pi-web-perm-"));
      tempDirs.push(permDir);
      const cfgPath = join(permDir, "web.json");
      writeFileSync(cfgPath, "{}");
      chmodSync(cfgPath, 0o000);
      state.agentDir = permDir;
      try {
        const permNotify = vi.fn();
        await command.handler("settings", {
          hasUI: true,
          mode: "print",
          ui: { pasteToEditor: vi.fn(), notify: permNotify, custom: vi.fn() },
        });
        expect(permNotify).toHaveBeenCalledWith(
          expect.stringContaining("OS permission denied"),
          "error",
        );
      } finally {
        chmodSync(cfgPath, 0o600);
      }
    }
  });

  it("does not notify on /web settings when hasUI is false even with diagnostics", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-web-noui-"));
    tempDirs.push(dir);
    state.agentDir = dir;
    writeFileSync(join(dir, "web.json"), "{bad");

    const pi = createMockPi();
    extension(pi as never);
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    const notify = vi.fn();

    await command.handler("settings", {
      hasUI: false,
      mode: "print",
      ui: { pasteToEditor: vi.fn(), notify, custom: vi.fn() },
    });

    expect(notify).not.toHaveBeenCalled();
  });
});
