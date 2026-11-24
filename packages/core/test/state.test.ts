import { describe, expect, it, vi } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import {
  dropSession as barrelDropSession,
  effectiveCwd as barrelEffectiveCwd,
  resetSession as barrelResetSession,
  setCwd as barrelSetCwd,
  setMode as barrelSetMode,
} from "../src/index.js";
import {
  enterMode,
  registerMode,
  registerModeGate,
  resetSession,
} from "../src/modes.js";
import {
  appendSessionEntry,
  dropSession,
  effectiveCwd,
  readBranchEntries,
  readPersistedMode,
  session,
  setCwd,
  setMode,
} from "../src/state.js";
import type { Effect, Tag } from "../src/types.js";

const ALLOW: Record<Tag, Effect> = {
  read: "allow",
  search: "allow",
  edit: "allow",
  shell: "allow",
  external: "allow",
};

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

describe("session state", () => {
  it("defaults to manual and stores mode per owner", () => {
    const owner = {};
    expect(session(owner)).toEqual({ mode: "manual" });
    setMode(owner, "plan");
    expect(session(owner).mode).toBe("plan");
    expect(session({}).mode).toBe("manual");
    dropSession(owner);
  });

  it("stores and clears the cwd override", () => {
    const owner = {};
    expect(effectiveCwd("/work", owner)).toBe("/work");
    setCwd(owner, "/work/sub");
    expect(session(owner)).toEqual({ mode: "manual", cwd: "/work/sub" });
    expect(effectiveCwd("/work", owner)).toBe("/work/sub");
    setCwd(owner, undefined);
    expect(session(owner)).toEqual({ mode: "manual" });
    expect(effectiveCwd("/work", owner)).toBe("/work");
    dropSession(owner);
  });

  it("drops the whole session", () => {
    const owner = {};
    setMode(owner, "edit");
    setCwd(owner, "/work/sub");
    dropSession(owner);
    expect(session(owner)).toEqual({ mode: "manual" });
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

  it("reads the last valid mode entry via getBranch", () => {
    const owner = {
      getBranch: () => [
        { customType: "hollowheap.core.mode", data: { mode: "edit" } },
      ],
    };
    expect(readPersistedMode(owner)).toBe("edit");
  });

  it("shares state across module instances", async () => {
    const owner = {};
    setMode(owner, "plan");
    setCwd(owner, "/work/sub");
    vi.resetModules();
    const fresh = await import("../src/state.js");
    expect(fresh.session(owner)).toEqual({ mode: "plan", cwd: "/work/sub" });
    fresh.dropSession(owner);
    expect(session(owner)).toEqual({ mode: "manual" });
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
    setMode(owner, "manual");
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

  it("falls back to manual when the restored layer is gone", () => {
    const owner = ownerWith([
      { customType: "hollowheap.core.mode", data: { mode: "removed" } },
    ]);
    const result = resetSession(owner);
    expect(result.mode).toBe("manual");
    expect(result.diagnostic).toContain("no longer exists");
    expect(session(owner).mode).toBe("manual");
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
    expect(result.mode).toBe("manual");
    expect(result.veto).toBe("no budget");
    expect(session(owner).mode).toBe("manual");
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

describe("branch entry helpers", () => {
  it("readBranchEntries prefers getBranch, falls back to getEntries, and handles errors", () => {
    const branchEntries = [{ customType: "a", data: 1 }];
    const allEntries = [{ customType: "b", data: 2 }];
    expect(
      readBranchEntries({
        getBranch: () => branchEntries,
        getEntries: () => allEntries,
      }),
    ).toBe(branchEntries);
    expect(readBranchEntries({ getEntries: () => allEntries })).toBe(
      allEntries,
    );
    expect(
      readBranchEntries({
        getBranch: () => {
          throw new Error("boom");
        },
      }),
    ).toBeUndefined();
    expect(readBranchEntries(undefined)).toBeUndefined();
  });

  it("appendSessionEntry prefers pi.appendEntry, falls back when missing, and returns success boolean", () => {
    const piAppend = vi.fn();
    const ownerAppendCustom = vi.fn();

    expect(
      appendSessionEntry(
        { appendEntry: piAppend },
        { appendCustomEntry: ownerAppendCustom },
        "custom.type",
        { ok: true },
      ),
    ).toBe(true);
    expect(piAppend).toHaveBeenCalledWith("custom.type", { ok: true });
    expect(ownerAppendCustom).not.toHaveBeenCalled();

    expect(
      appendSessionEntry(
        undefined,
        { appendCustomEntry: ownerAppendCustom },
        "custom.type",
        { fallback: true },
      ),
    ).toBe(true);
    expect(ownerAppendCustom).toHaveBeenCalledWith("custom.type", {
      fallback: true,
    });

    ownerAppendCustom.mockClear();
    expect(
      appendSessionEntry(
        {
          appendEntry: () => {
            throw new Error("no session");
          },
        },
        { appendCustomEntry: ownerAppendCustom },
        "custom.type",
        { recovered: true },
      ),
    ).toBe(false);
    expect(ownerAppendCustom).not.toHaveBeenCalled();

    expect(
      appendSessionEntry(
        undefined,
        {
          appendCustomEntry: () => {
            throw new Error("no session");
          },
        },
        "custom.type",
        { failed: true },
      ),
    ).toBe(false);

    expect(appendSessionEntry(undefined, undefined, "custom.type", {})).toBe(
      false,
    );
  });
});

describe("session state public seam", () => {
  it("resetSession restores the persisted cwd with the persisted mode", () => {
    const entries: { customType: string; data?: unknown }[] = [];
    const owner = {
      appendCustomEntry: (customType: string, data?: unknown) => {
        entries.push({ customType, data });
        return "entry";
      },
      getBranch: () => entries,
    };

    barrelSetMode(owner, "plan");
    barrelSetCwd(owner, "/work/sub", { persist: true });
    barrelResetSession(owner);

    expect(barrelEffectiveCwd("/work", owner)).toBe("/work/sub");
    barrelDropSession(owner);
  });
});
