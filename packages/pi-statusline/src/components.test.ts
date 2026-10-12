import { describe, expect, it, vi } from "vitest";
import {
  BUILTINS,
  type ComponentContext,
  clockIntervalMs,
  createGitDiffCache,
  formatClock,
  formatCount,
  parseGitPorcelain,
  shortenPath,
} from "./components.js";

function ctx(overrides: Partial<ComponentContext> = {}): ComponentContext {
  return {
    cwd: "/home/u/projects/app",
    homeDir: "/home/u",
    modelId: "anthropic/claude-opus-4-6",
    branch: "main",
    tokens: { input: 1500, output: 250, cost: 0.042 },
    contextPercent: 43.6,
    busy: false,
    now: new Date(2026, 9, 12, 14, 5, 9),
    gitDiff: undefined,
    ...overrides,
  };
}

describe("mode", () => {
  it("shows idle and working text", () => {
    expect(BUILTINS.mode({ type: "mode" }, ctx())).toBe("IDLE");
    expect(BUILTINS.mode({ type: "mode" }, ctx({ busy: true }))).toBe(
      "WORKING",
    );
    expect(
      BUILTINS.mode(
        { type: "mode", idleText: "ok", workingText: "run" },
        ctx({ busy: true }),
      ),
    ).toBe("run");
  });
});

describe("cwd", () => {
  it("replaces home with tilde", () => {
    expect(BUILTINS.cwd({ type: "cwd" }, ctx())).toBe("~/projects/app");
  });

  it("keeps full paths outside home and honors depth", () => {
    expect(
      BUILTINS.cwd(
        { type: "cwd" },
        ctx({ cwd: "/etc/ssl/certs", homeDir: "/home/u" }),
      ),
    ).toBe("/etc/ssl/certs");
    expect(BUILTINS.cwd({ type: "cwd", depth: 1 }, ctx())).toBe("~/…/app");
    expect(BUILTINS.cwd({ type: "cwd", depth: 5 }, ctx())).toBe(
      "~/projects/app",
    );
  });

  it("shortenPath handles root and exact home", () => {
    expect(shortenPath("/home/u", "/home/u", undefined)).toBe("~");
    expect(shortenPath("/a/b", "", 1)).toBe("/…/b");
  });
});

describe("git components", () => {
  it("git_branch hides outside a repo and supports an icon", () => {
    expect(
      BUILTINS.git_branch({ type: "git_branch" }, ctx({ branch: null })),
    ).toBe("");
    expect(BUILTINS.git_branch({ type: "git_branch" }, ctx())).toBe("main");
    expect(BUILTINS.git_branch({ type: "git_branch", icon: " " }, ctx())).toBe(
      " main",
    );
  });

  it("git_diff renders nothing without data or when clean", () => {
    expect(BUILTINS.git_diff({ type: "git_diff" }, ctx())).toBe("");
    expect(
      BUILTINS.git_diff(
        { type: "git_diff" },
        ctx({ gitDiff: { added: 0, modified: 0, removed: 0, untracked: 0 } }),
      ),
    ).toBe("");
  });

  it("git_diff formats nonzero counts with icons", () => {
    const c = ctx({
      gitDiff: { added: 3, modified: 0, removed: 1, untracked: 2 },
    });
    expect(BUILTINS.git_diff({ type: "git_diff" }, c)).toBe("+3 -1 ?2");
  });

  it("parseGitPorcelain classifies status codes", () => {
    expect(
      parseGitPorcelain("A  new.ts\n M edit.ts\nD  gone.ts\n?? fresh.ts\n"),
    ).toEqual({
      added: 1,
      modified: 1,
      removed: 1,
      untracked: 1,
    });
  });
});

describe("model", () => {
  it("shortens provider prefixes by default", () => {
    expect(BUILTINS.model({ type: "model" }, ctx())).toBe("claude-opus-4-6");
    expect(BUILTINS.model({ type: "model", shorten: false }, ctx())).toBe(
      "anthropic/claude-opus-4-6",
    );
    expect(BUILTINS.model({ type: "model" }, ctx({ modelId: undefined }))).toBe(
      "",
    );
  });
});

describe("token components", () => {
  it("tokens formats input and output", () => {
    expect(BUILTINS.tokens({ type: "tokens" }, ctx())).toBe("↑1.5k ↓250");
    expect(BUILTINS.tokens({ type: "tokens", showInput: false }, ctx())).toBe(
      "↓250",
    );
  });

  it("formatCount handles thousands", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1500)).toBe("1.5k");
    expect(formatCount(250000)).toBe("250k");
  });

  it("cost honors decimals and prefix", () => {
    expect(BUILTINS.cost({ type: "cost" }, ctx())).toBe("$0.042");
    expect(BUILTINS.cost({ type: "cost", decimals: 1 }, ctx())).toBe("$0.0");
  });

  it("context rounds percent and hides unknown", () => {
    expect(BUILTINS.context({ type: "context" }, ctx())).toBe("44%");
    expect(
      BUILTINS.context({ type: "context" }, ctx({ contextPercent: null })),
    ).toBe("");
  });
});

describe("clock and text", () => {
  it("clock formats date tokens", () => {
    expect(formatClock(new Date(2026, 9, 12, 14, 5, 9), "HH:mm")).toBe("14:05");
    expect(
      BUILTINS.clock({ type: "clock", format: "YYYY-MM-DD HH:mm:ss" }, ctx()),
    ).toBe("2026-10-12 14:05:09");
  });

  it("text passes through and defaults to empty", () => {
    expect(BUILTINS.text({ type: "text", text: "hi" }, ctx())).toBe("hi");
    expect(BUILTINS.text({ type: "text" }, ctx())).toBe("");
  });
});

describe("clockIntervalMs", () => {
  it("returns undefined without a clock and picks the fastest clock", () => {
    expect(clockIntervalMs({ a: [{ type: "mode" }] })).toBeUndefined();
    expect(clockIntervalMs({ z: [{ type: "clock" }] })).toBe(15000);
    expect(
      clockIntervalMs({ z: [{ type: "clock", format: "HH:mm:ss" }] }),
    ).toBe(1000);
    expect(clockIntervalMs({ z: [{ type: "clock", intervalMs: 2000 }] })).toBe(
      2000,
    );
    expect(
      clockIntervalMs({
        y: [{ type: "clock", format: "HH:mm:ss" }],
        z: [{ type: "clock", intervalMs: 500 }],
      }),
    ).toBe(500);
  });
});

describe("createGitDiffCache", () => {
  it("fills asynchronously and notifies", async () => {
    const runner = vi.fn(async () => " M a.ts\n?? b.ts\n");
    const onUpdate = vi.fn();
    const cache = createGitDiffCache(runner, onUpdate, 5000);
    expect(cache.get("/repo")).toBeUndefined();
    await vi.waitFor(() =>
      expect(cache.get("/repo")).toEqual({
        added: 0,
        modified: 1,
        removed: 0,
        untracked: 1,
      }),
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalled();
  });

  it("stores undefined on failure and refreshes stale entries", async () => {
    const runner = vi.fn(async () => {
      throw new Error("no git");
    });
    const cache = createGitDiffCache(runner, () => {}, -1);
    cache.refresh("/repo");
    await vi.waitFor(() => {
      cache.get("/repo");
      expect(runner.mock.calls.length).toBeGreaterThan(1);
    });
    expect(cache.get("/repo")).toBeUndefined();
  });
});
