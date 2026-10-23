import { describe, expect, it, vi } from "vitest";
import {
  enterMode,
  registerMode,
  registerModeGate,
  resetSession,
} from "./modes.js";
import {
  dropSession,
  effectiveCwd,
  readPersistedMode,
  session,
  setCwd,
  setMode,
} from "./state.js";
import type { Effect, Tag } from "./types.js";

const ALLOW: Record<Tag, Effect> = {
  read: "allow",
  search: "allow",
  edit: "allow",
  shell: "allow",
};

describe("session state", () => {
  it("defaults to ask and stores mode per owner", () => {
    const owner = {};
    expect(session(owner)).toEqual({ mode: "ask" });
    setMode(owner, "plan");
    expect(session(owner).mode).toBe("plan");
    expect(session({}).mode).toBe("ask");
    dropSession(owner);
  });

  it("stores and clears the cwd override", () => {
    const owner = {};
    expect(effectiveCwd("/work", owner)).toBe("/work");
    setCwd(owner, "/work/sub");
    expect(session(owner)).toEqual({ mode: "ask", cwd: "/work/sub" });
    expect(effectiveCwd("/work", owner)).toBe("/work/sub");
    setCwd(owner, undefined);
    expect(session(owner)).toEqual({ mode: "ask" });
    expect(effectiveCwd("/work", owner)).toBe("/work");
    dropSession(owner);
  });

  it("drops the whole session", () => {
    const owner = {};
    setMode(owner, "edit");
    setCwd(owner, "/work/sub");
    dropSession(owner);
    expect(session(owner)).toEqual({ mode: "ask" });
    expect(effectiveCwd("/work", owner)).toBe("/work");
  });

  it("persists mode changes to the session", () => {
    const entries: { customType: string; data?: unknown }[] = [];
    const owner = {
      appendCustomEntry: (customType: string, data?: unknown) => {
        entries.push({ customType, data });
        return "entry";
      },
      getEntries: () => entries,
    };
    setMode(owner, "plan");
    setMode(owner, "plan");
    setMode(owner, "ask");
    expect(entries).toEqual([
      { customType: "hollowheap.core.mode", data: { mode: "plan" } },
      { customType: "hollowheap.core.mode", data: { mode: "ask" } },
    ]);
    expect(readPersistedMode(owner)).toBe("ask");
    dropSession(owner);
  });

  it("reads the last valid mode entry", () => {
    const owner = {
      getEntries: () => [
        { customType: "other", data: { mode: "plan" } },
        { customType: "hollowheap.core.mode", data: { mode: "edit" } },
        { customType: "hollowheap.core.mode", data: { mode: "plan" } },
        { customType: "hollowheap.core.mode", data: {} },
      ],
    };
    expect(readPersistedMode(owner)).toBe("plan");
    expect(readPersistedMode({})).toBeUndefined();
  });

  it("shares state across module instances", async () => {
    const owner = {};
    setMode(owner, "plan");
    setCwd(owner, "/work/sub");
    vi.resetModules();
    const fresh = await import("./state.js");
    expect(fresh.session(owner)).toEqual({ mode: "plan", cwd: "/work/sub" });
    fresh.dropSession(owner);
    expect(session(owner)).toEqual({ mode: "ask" });
  });
});

describe("session restore", () => {
  function ownerWith(entries: { customType: string; data?: unknown }[]) {
    return {
      getEntries: () => entries,
      appendCustomEntry: (customType: string, data?: unknown) => {
        entries.push({ customType, data });
        return "entry";
      },
    };
  }

  it("restores the last persisted mode and clears cwd", () => {
    const owner = ownerWith([
      { customType: "hollowheap.core.mode", data: { mode: "plan" } },
      { customType: "hollowheap.core.mode", data: { mode: "edit" } },
    ]);
    setMode(owner, "ask");
    setCwd(owner, "/work/sub");
    const result = resetSession(owner);
    expect(result.mode).toBe("edit");
    expect(session(owner)).toEqual({ mode: "edit" });
    dropSession(owner);
  });

  it("keeps the mode across a resume and a fork", () => {
    const entries = [
      { customType: "hollowheap.core.mode", data: { mode: "plan" } },
    ];
    const resumed = ownerWith(entries);
    expect(resetSession(resumed).mode).toBe("plan");
    dropSession(resumed);

    const forked = ownerWith([...entries]);
    expect(resetSession(forked).mode).toBe("plan");
    dropSession(forked);
  });

  it("falls back to ask when the restored layer is gone", () => {
    const owner = ownerWith([
      { customType: "hollowheap.core.mode", data: { mode: "removed" } },
    ]);
    const result = resetSession(owner);
    expect(result.mode).toBe("ask");
    expect(result.diagnostic).toContain("no longer exists");
    expect(session(owner).mode).toBe("ask");
    dropSession(owner);
  });

  it("re-runs entry gates on restore and falls back on veto", () => {
    registerMode({ name: "restore-gated", defaults: ALLOW });
    const stop = registerModeGate((mode) =>
      mode === "restore-gated" ? { veto: "no budget" } : undefined,
    );
    const owner = ownerWith([
      { customType: "hollowheap.core.mode", data: { mode: "restore-gated" } },
    ]);
    const result = resetSession(owner);
    expect(result.mode).toBe("ask");
    expect(result.veto).toBe("no budget");
    expect(session(owner).mode).toBe("ask");
    stop();
    dropSession(owner);
  });

  it("persists mode switches through enterMode", () => {
    const entries: { customType: string; data?: unknown }[] = [];
    const owner = {
      getEntries: () => entries,
      appendCustomEntry: (customType: string, data?: unknown) => {
        entries.push({ customType, data });
        return "entry";
      },
    };
    enterMode(owner, "plan");
    expect(entries).toEqual([
      { customType: "hollowheap.core.mode", data: { mode: "plan" } },
    ]);
    dropSession(owner);
  });
});
