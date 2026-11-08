import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModesConfig, loadPermissions, loadToolTags } from "./config.js";
import { modeNames, replaceConfigModes } from "./modes.js";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-core-config-"));
}

function write(path: string, content: string, seconds: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  const time = new Date(seconds * 1000);
  utimesSync(path, time, time);
}

function load(
  agentDir: string,
  root: string,
  trusted: boolean,
  diagnostics: string[] = [],
): ReturnType<typeof loadPermissions> {
  return loadPermissions({
    agentDir,
    workspaceRoot: root,
    trusted,
    onDiagnostic: (message) => diagnostics.push(message),
  });
}

function loadQuiet(
  agentDir: string,
  root: string,
  trusted: boolean,
): ReturnType<typeof loadPermissions> {
  return loadPermissions({ agentDir, workspaceRoot: root, trusted });
}

describe("loadPermissions", () => {
  it("parses object and string rules with widened effects", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify({
        rules: [
          { tag: "edit", pattern: "src/**", effect: "ask" },
          "deny shell rm -rf",
          { tag: "read", pattern: "*", effect: "allow" },
        ],
      }),
      1_000,
    );
    expect(load(agentDir, root, false)).toEqual([
      { tag: "edit", pattern: "src/**", effect: "ask" },
      { tag: "shell", pattern: "rm -rf", effect: "deny" },
      { tag: "read", pattern: "*", effect: "allow" },
    ]);
  });

  it("merges the project overlay only when trusted", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify([{ tag: "read", pattern: "*", effect: "allow" }]),
      1_000,
    );
    write(
      join(root, ".pi", "permissions.json"),
      JSON.stringify([{ tag: "edit", pattern: "src/*", effect: "deny" }]),
      1_000,
    );

    expect(load(agentDir, root, true)).toHaveLength(2);

    const diagnostics: string[] = [];
    expect(load(agentDir, root, false, diagnostics)).toHaveLength(1);
    expect(load(agentDir, root, false, diagnostics)).toHaveLength(1);
    expect(diagnostics).toEqual([
      "ignoring .pi/permissions.json: project is not trusted",
    ]);
  });

  it("reports parse diagnostics once per mtime change and fails closed to ask rules", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    const path = join(agentDir, "permissions.json");
    const diagnostics: string[] = [];

    write(path, "{", 1_000);
    const fallbackRules = load(agentDir, root, false, diagnostics);
    expect(fallbackRules.length).toBeGreaterThan(0);
    expect(fallbackRules.every((r) => r.effect === "ask")).toBe(true);
    expect(load(agentDir, root, false, diagnostics)).toEqual(fallbackRules);
    expect(diagnostics).toHaveLength(1);

    write(
      path,
      JSON.stringify([{ tag: "read", pattern: "*", effect: "allow" }]),
      1_001,
    );
    expect(load(agentDir, root, false, diagnostics)).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);

    write(path, "{", 1_002);
    expect(load(agentDir, root, false, diagnostics)).toEqual(fallbackRules);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[1]).toContain("not valid JSON");
  });

  it("skips invalid rules with diagnostics", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    const diagnostics: string[] = [];
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify({
        rules: [
          { tag: "bogus tag", pattern: "*", effect: "allow" },
          { tag: "edit", pattern: "", effect: "allow" },
          { tag: "edit", pattern: "*", effect: "block" },
          42,
        ],
      }),
      1_000,
    );
    expect(load(agentDir, root, false, diagnostics)).toEqual([]);
    expect(diagnostics).toHaveLength(4);
  });

  it("accepts custom permission categories", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify({
        rules: [
          { tag: "custom", pattern: "https://example.com/*", effect: "ask" },
        ],
        tools: { mcp__example: "custom" },
      }),
      1_000,
    );

    const rules = load(agentDir, root, false);
    expect(rules).toEqual([
      { tag: "custom", pattern: "https://example.com/*", effect: "ask" },
    ]);
    expect(
      loadToolTags({ agentDir, workspaceRoot: root, trusted: false }),
    ).toEqual({ mcp__example: "custom" });
  });

  it("returns cached rules when the mtime is unchanged", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    const path = join(agentDir, "permissions.json");
    const diagnostics: string[] = [];

    write(
      path,
      JSON.stringify([{ tag: "read", pattern: "*", effect: "allow" }]),
      1_000,
    );
    expect(load(agentDir, root, false, diagnostics)).toHaveLength(1);

    write(path, "{", 1_000);
    expect(load(agentDir, root, false, diagnostics)).toEqual([
      { tag: "read", pattern: "*", effect: "allow" },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("delivers cached diagnostics to a later caller with a callback", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    write(join(agentDir, "permissions.json"), "{", 1_000);

    const quietRules = loadQuiet(agentDir, root, false);
    expect(quietRules.every((r) => r.effect === "ask")).toBe(true);
    const diagnostics: string[] = [];
    expect(load(agentDir, root, false, diagnostics)).toEqual(quietRules);
    expect(diagnostics).toHaveLength(1);
    expect(load(agentDir, root, false, diagnostics)).toEqual(quietRules);
    expect(diagnostics).toHaveLength(1);
  });

  it("returns a copy and freezes rule objects", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify([{ tag: "read", pattern: "*", effect: "allow" }]),
      1_000,
    );

    const first = load(agentDir, root, false);
    first.push({ tag: "edit", pattern: "*", effect: "deny" });
    expect(first).toHaveLength(2);
    expect(load(agentDir, root, false)).toHaveLength(1);
    expect(() => {
      const rule = load(agentDir, root, false)[0];
      if (rule !== undefined) rule.effect = "deny";
    }).toThrow();
  });

  it("invalidates when the overlay appears", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify([{ tag: "read", pattern: "*", effect: "allow" }]),
      1_000,
    );
    expect(load(agentDir, root, true)).toHaveLength(1);
    write(
      join(root, ".pi", "permissions.json"),
      JSON.stringify([{ tag: "edit", pattern: "*", effect: "deny" }]),
      1_000,
    );
    expect(load(agentDir, root, true)).toHaveLength(2);
  });

  it("returns default safe shell rules when no files exist", () => {
    const root = workspace();
    const diagnostics: string[] = [];
    expect(load(join(root, "agent"), root, true, diagnostics)).toEqual([
      { effect: "allow", tag: "shell", pattern: "head" },
      { effect: "allow", tag: "shell", pattern: "tail" },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("keeps caches separate per workspace", () => {
    const one = workspace();
    const two = workspace();
    const agentDir = join(one, "agent");
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify([{ tag: "read", pattern: "*", effect: "allow" }]),
      1_000,
    );
    write(
      join(one, ".pi", "permissions.json"),
      JSON.stringify([{ tag: "edit", pattern: "one", effect: "deny" }]),
      1_000,
    );
    write(
      join(two, ".pi", "permissions.json"),
      JSON.stringify([{ tag: "edit", pattern: "two", effect: "deny" }]),
      1_000,
    );

    expect(load(agentDir, one, true)).toHaveLength(2);
    expect(load(agentDir, two, true)).toEqual([
      { tag: "read", pattern: "*", effect: "allow" },
      { tag: "edit", pattern: "two", effect: "deny" },
    ]);
  });
});

describe("loadToolTags", () => {
  it("parses tool tags from the permissions file", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify({
        tools: {
          mcp__docs__search: "search",
          mcp__docs__read: "read",
          mcp__docs__edit: "edit",
          mcp__docs__shell: "shell",
        },
      }),
      1_000,
    );

    expect(
      loadToolTags({ agentDir, workspaceRoot: root, trusted: false }),
    ).toEqual({
      mcp__docs__search: "search",
      mcp__docs__read: "read",
      mcp__docs__edit: "edit",
      mcp__docs__shell: "shell",
    });
  });

  it("ignores invalid tags with diagnostics", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    const diagnostics: string[] = [];
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify({
        tools: { good: "read", bad: "Bad Tag", "": "read", number: 7 },
      }),
      1_000,
    );

    expect(
      loadToolTags({
        agentDir,
        workspaceRoot: root,
        trusted: false,
        onDiagnostic: (message) => diagnostics.push(message),
      }),
    ).toEqual({ good: "read" });
    expect(diagnostics).toHaveLength(3);
  });

  it("merges the trusted project overlay", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify({ tools: { agent: "read", shared: "read" } }),
      1_000,
    );
    write(
      join(root, ".pi", "permissions.json"),
      JSON.stringify({ tools: { project: "search", shared: "search" } }),
      1_000,
    );

    expect(
      loadToolTags({ agentDir, workspaceRoot: root, trusted: true }),
    ).toEqual({
      agent: "read",
      project: "search",
      shared: "search",
    });
    expect(
      loadToolTags({ agentDir, workspaceRoot: root, trusted: false }),
    ).toEqual({ agent: "read", shared: "read" });
  });

  it("reports invalid tools objects", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    const diagnostics: string[] = [];
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify({ tools: ["read"] }),
      1_000,
    );
    loadToolTags({
      agentDir,
      workspaceRoot: root,
      trusted: false,
      onDiagnostic: (message) => diagnostics.push(message),
    });
    expect(diagnostics[0]).toContain('"tools" must be an object');
  });
});

describe("loadModesConfig", () => {
  function writeModes(
    agentDir: string,
    content: string,
    seconds: number,
  ): void {
    write(join(agentDir, "modes.json"), content, seconds);
  }

  const VALID = JSON.stringify({
    modes: {
      readonly: {
        defaults: {
          read: "allow",
          search: "allow",
          edit: "deny",
          shell: "deny",
        },
        overrides: [{ tag: "edit", pattern: "docs/**", effect: "ask" }],
      },
    },
  });

  it("parses a valid layer with defaults and overrides", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    const diagnostics: string[] = [];
    writeModes(agentDir, VALID, 1_000);

    const layers = loadModesConfig(agentDir, (message) =>
      diagnostics.push(message),
    );
    expect(layers).toHaveLength(1);
    expect(layers[0].name).toBe("readonly");
    expect(layers[0].defaults).toEqual({
      read: "allow",
      search: "allow",
      edit: "deny",
      shell: "deny",
      external: "allow",
    });
    expect(layers[0].overrides).toEqual([
      { tag: "edit", pattern: "docs/**", effect: "ask" },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("drops a layer that misses a default tag", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    const diagnostics: string[] = [];
    writeModes(
      agentDir,
      JSON.stringify({
        modes: {
          broken: { defaults: { read: "allow", search: "allow", edit: "ask" } },
        },
      }),
      1_000,
    );

    expect(
      loadModesConfig(agentDir, (message) => diagnostics.push(message)),
    ).toEqual([]);
    expect(diagnostics[0]).toContain("missing default");
  });

  it("ignores allow overrides with a diagnostic", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    const diagnostics: string[] = [];
    writeModes(
      agentDir,
      JSON.stringify({
        modes: {
          readonly: {
            defaults: {
              read: "allow",
              search: "allow",
              edit: "deny",
              shell: "deny",
            },
            overrides: [{ tag: "edit", pattern: "docs/**", effect: "allow" }],
          },
        },
      }),
      1_000,
    );

    const layers = loadModesConfig(agentDir, (message) =>
      diagnostics.push(message),
    );
    expect(layers).toHaveLength(1);
    expect(layers[0].overrides).toEqual([]);
    expect(diagnostics[0]).toContain('overrides must be "ask" or "deny"');
  });

  it("rejects a layer whose name is already registered", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    const diagnostics: string[] = [];
    writeModes(
      agentDir,
      JSON.stringify({
        modes: {
          ask: {
            defaults: {
              read: "allow",
              search: "allow",
              edit: "allow",
              shell: "allow",
            },
          },
        },
      }),
      1_000,
    );

    expect(
      loadModesConfig(agentDir, (message) => diagnostics.push(message)),
    ).toEqual([]);
    expect(diagnostics[0]).toContain("already registered");
  });

  it("replaces config layers when the file changes", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    writeModes(agentDir, VALID, 1_000);
    replaceConfigModes(loadModesConfig(agentDir));
    expect(modeNames()).toContain("readonly");

    writeModes(
      agentDir,
      JSON.stringify({
        modes: {
          other: {
            defaults: {
              read: "allow",
              search: "allow",
              edit: "ask",
              shell: "ask",
            },
          },
        },
      }),
      1_001,
    );
    replaceConfigModes(loadModesConfig(agentDir));
    expect(modeNames()).not.toContain("readonly");
    expect(modeNames()).toContain("other");
    replaceConfigModes([]);
  });

  it("reports diagnostics once per change", () => {
    const root = workspace();
    const agentDir = join(root, "agent");
    const diagnostics: string[] = [];
    writeModes(agentDir, "{", 1_000);

    expect(
      loadModesConfig(agentDir, (message) => diagnostics.push(message)),
    ).toEqual([]);
    expect(
      loadModesConfig(agentDir, (message) => diagnostics.push(message)),
    ).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("not valid JSON");
  });

  it("returns no layers when the file is missing", () => {
    const root = workspace();
    const diagnostics: string[] = [];
    expect(
      loadModesConfig(join(root, "agent"), (message) =>
        diagnostics.push(message),
      ),
    ).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});

describe("updateJsonConfig", () => {
  it("creates a missing file and writes through temp file and rename", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { updateJsonConfig } = await import("./config.js");
    const root = workspace();
    const path = join(root, "nested", "settings.json");

    const result = updateJsonConfig(path, (current) => {
      current.theme = "dark";
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ theme: "dark" });
    expect(
      readdirSync(dirname(path)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("preserves untouched fields on a valid object config", async () => {
    const { readFileSync } = await import("node:fs");
    const { updateJsonConfig } = await import("./config.js");
    const root = workspace();
    const path = join(root, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({ keep: { nested: 1 }, count: 2 }, null, 2),
    );

    const result = updateJsonConfig(path, (current) => ({
      ...current,
      count: 3,
    }));

    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      keep: { nested: 1 },
      count: 3,
    });
  });

  it("refuses to overwrite invalid JSON or non-object JSON and leaves file byte-identical", async () => {
    const { readFileSync } = await import("node:fs");
    const { updateJsonConfig } = await import("./config.js");
    const root = workspace();
    const brokenPath = join(root, "broken.json");
    const rawBroken = "{ not valid json // keep comment\n";
    writeFileSync(brokenPath, rawBroken);

    const brokenResult = updateJsonConfig(brokenPath, (current) => {
      current.overwritten = true;
    });

    expect(brokenResult.ok).toBe(false);
    if (!brokenResult.ok) {
      expect(brokenResult.error).toContain(brokenPath);
    }
    expect(readFileSync(brokenPath, "utf8")).toBe(rawBroken);

    const arrayPath = join(root, "array.json");
    const rawArray = "[1, 2, 3]\n";
    writeFileSync(arrayPath, rawArray);

    const arrayResult = updateJsonConfig(arrayPath, (current) => {
      current.overwritten = true;
    });

    expect(arrayResult.ok).toBe(false);
    if (!arrayResult.ok) {
      expect(arrayResult.error).toContain(arrayPath);
    }
    expect(readFileSync(arrayPath, "utf8")).toBe(rawArray);
  });
});
