import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_FILE_NAME, loadSubagentsConfig } from "./config.js";

function agentDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-subagents-config-"));
}

function write(dir: string, content: string): void {
  writeFileSync(join(dir, CONFIG_FILE_NAME), content);
}

describe("loadSubagentsConfig", () => {
  it("returns defaults when the file is missing", () => {
    const dir = agentDir();
    const config = loadSubagentsConfig(dir);
    expect(config.maxConcurrent).toBe(4);
    expect(config.maxDepth).toBe(1);
    expect(config.defaultTimeoutMs).toBe(30 * 60 * 1000);
    expect(config.writeLockTimeoutMs).toBe(30 * 1000);
    expect(config.maxSessionAgents).toBe(32);
    expect(config.maxSessionAgentBytes).toBe(65_536);
    expect(config.path).toBe(join(dir, CONFIG_FILE_NAME));
    expect(config.harnesses).toEqual({});
    expect(config.diagnostics).toEqual([]);
  });

  it("accepts a valid config", () => {
    const dir = agentDir();
    write(
      dir,
      JSON.stringify({
        maxConcurrent: 8,
        maxDepth: 3,
        defaultTimeoutMs: 0,
        writeLockTimeoutMs: 300000,
        maxSessionAgents: 64,
        maxSessionAgentBytes: 131072,
      }),
    );
    const config = loadSubagentsConfig(dir);
    expect(config.maxConcurrent).toBe(8);
    expect(config.maxDepth).toBe(3);
    expect(config.defaultTimeoutMs).toBe(0);
    expect(config.writeLockTimeoutMs).toBe(300000);
    expect(config.maxSessionAgents).toBe(64);
    expect(config.maxSessionAgentBytes).toBe(131072);
    expect(config.diagnostics).toEqual([]);
  });

  it("defaults invalid values with diagnostics", () => {
    const dir = agentDir();
    const diagnostics: string[] = [];
    write(
      dir,
      JSON.stringify({
        maxConcurrent: 0,
        maxDepth: 5,
        defaultTimeoutMs: -1,
        writeLockTimeoutMs: 0,
      }),
    );
    const config = loadSubagentsConfig(dir, (message) =>
      diagnostics.push(message),
    );
    expect(config.maxConcurrent).toBe(4);
    expect(config.maxDepth).toBe(1);
    expect(config.defaultTimeoutMs).toBe(30 * 60 * 1000);
    expect(config.writeLockTimeoutMs).toBe(30 * 1000);
    expect(diagnostics).toHaveLength(4);
  });

  it("defaults invalid session definition bounds with diagnostics", () => {
    const dir = agentDir();
    write(
      dir,
      JSON.stringify({ maxSessionAgents: 0, maxSessionAgentBytes: 1 }),
    );
    const config = loadSubagentsConfig(dir);
    expect(config.maxSessionAgents).toBe(32);
    expect(config.maxSessionAgentBytes).toBe(65_536);
    expect(config.diagnostics).toHaveLength(2);
  });

  it("parses generic harness definitions", () => {
    const dir = agentDir();
    write(
      dir,
      JSON.stringify({
        harnesses: {
          claude: {
            command: "claude",
            args: ["-p", "{prompt}"],
            input: "arg",
            env: { ANTHROPIC_MODEL: "sonnet" },
          },
        },
      }),
    );
    const config = loadSubagentsConfig(dir);
    expect(config.harnesses.claude).toEqual({
      command: "claude",
      args: ["-p", "{prompt}"],
      input: "arg",
      env: { ANTHROPIC_MODEL: "sonnet" },
    });
    expect(config.diagnostics).toEqual([]);
  });

  it("diagnoses invalid harness definitions", () => {
    const dir = agentDir();
    write(
      dir,
      JSON.stringify({
        harnesses: {
          "bad name": { command: "x" },
          empty: {},
          args: { command: "x", args: "nope" },
          input: { command: "x", input: "pipe" },
          env: { command: "x", env: { TOKEN: 1 } },
        },
      }),
    );
    const config = loadSubagentsConfig(dir);
    expect(config.harnesses).toEqual({});
    expect(config.diagnostics).toHaveLength(5);
  });

  it("diagnoses an existing unreadable config", () => {
    const dir = agentDir();
    mkdirSync(join(dir, CONFIG_FILE_NAME));
    const diagnostics: string[] = [];
    const config = loadSubagentsConfig(dir, (message) =>
      diagnostics.push(message),
    );
    expect(config.maxConcurrent).toBe(4);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain(CONFIG_FILE_NAME);
  });

  it("reports invalid JSON and non-object roots", () => {
    const json = agentDir();
    write(json, "{");
    expect(loadSubagentsConfig(json).diagnostics[0]).toContain(
      "is not valid JSON",
    );

    const array = agentDir();
    write(array, "[]");
    expect(loadSubagentsConfig(array).diagnostics[0]).toContain(
      "must be an object",
    );
  });

  it("does not leak invalid values in diagnostics", () => {
    const dir = agentDir();
    const secret = "secret-value";
    write(dir, JSON.stringify({ maxConcurrent: secret }));
    const diagnostics: string[] = [];
    loadSubagentsConfig(dir, (message) => diagnostics.push(message));
    expect(diagnostics.join(" ")).not.toContain(secret);
  });
});
