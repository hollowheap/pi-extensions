import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProjectAgentConfigFile, loadAgentConfig } from "./config.js";

let baseDir: string;
let agentDir: string;
let projectDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pi-agent-config-test-"));
  agentDir = join(baseDir, "user-agent");
  projectDir = join(baseDir, "workspace", "nested", "pkg");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(baseDir, { recursive: true, force: true });
  } catch {}
});

describe("loadAgentConfig", () => {
  it("returns empty result when no config files exist", () => {
    const result = loadAgentConfig({
      agentDir,
      cwd: projectDir,
      trusted: true,
    });
    expect(result.default).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
    expect(result.userConfigPath).toBeUndefined();
    expect(result.projectConfigPath).toBeUndefined();
  });

  it("loads default agent from user agent.json", () => {
    writeFileSync(
      join(agentDir, "agent.json"),
      JSON.stringify({ default: "engineer" }),
    );
    const result = loadAgentConfig({
      agentDir,
      cwd: projectDir,
      trusted: true,
    });
    expect(result.default).toBe("engineer");
    expect(result.diagnostics).toEqual([]);
    expect(result.userConfigPath).toBe(join(agentDir, "agent.json"));
  });

  it("accepts defaultAgent alias in agent.json", () => {
    writeFileSync(
      join(agentDir, "agent.json"),
      JSON.stringify({ defaultAgent: "architect" }),
    );
    const result = loadAgentConfig({
      agentDir,
      cwd: projectDir,
      trusted: true,
    });
    expect(result.default).toBe("architect");
    expect(result.diagnostics).toEqual([]);
  });

  it("overrides user default agent with trusted project agent.json", () => {
    writeFileSync(
      join(agentDir, "agent.json"),
      JSON.stringify({ default: "engineer" }),
    );
    const workspaceRoot = join(baseDir, "workspace");
    mkdirSync(join(workspaceRoot, ".pi"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".pi", "agent.json"),
      JSON.stringify({ default: "worker" }),
    );

    const result = loadAgentConfig({
      agentDir,
      cwd: projectDir,
      trusted: true,
    });
    expect(result.default).toBe("worker");
    expect(result.diagnostics).toEqual([]);
    expect(result.projectConfigPath).toBe(
      join(workspaceRoot, ".pi", "agent.json"),
    );
  });

  it("allows project config to unset user default with null", () => {
    writeFileSync(
      join(agentDir, "agent.json"),
      JSON.stringify({ default: "engineer" }),
    );
    const workspaceRoot = join(baseDir, "workspace");
    mkdirSync(join(workspaceRoot, ".pi"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".pi", "agent.json"),
      JSON.stringify({ default: null }),
    );

    const result = loadAgentConfig({
      agentDir,
      cwd: projectDir,
      trusted: true,
    });
    expect(result.default).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores project agent.json when project is not trusted", () => {
    writeFileSync(
      join(agentDir, "agent.json"),
      JSON.stringify({ default: "engineer" }),
    );
    const workspaceRoot = join(baseDir, "workspace");
    mkdirSync(join(workspaceRoot, ".pi"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".pi", "agent.json"),
      JSON.stringify({ default: "worker" }),
    );

    const result = loadAgentConfig({
      agentDir,
      cwd: projectDir,
      trusted: false,
    });
    expect(result.default).toBe("engineer");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toContain("project is not trusted");
  });

  it("reports diagnostic on invalid JSON", () => {
    writeFileSync(join(agentDir, "agent.json"), "{ invalid-json }");
    const result = loadAgentConfig({
      agentDir,
      cwd: projectDir,
      trusted: true,
    });
    expect(result.default).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toContain("not valid JSON");
  });

  it("reports diagnostic when default field is not a string", () => {
    writeFileSync(
      join(agentDir, "agent.json"),
      JSON.stringify({ default: 123 }),
    );
    const result = loadAgentConfig({
      agentDir,
      cwd: projectDir,
      trusted: true,
    });
    expect(result.default).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toContain('"default" must be a string');
  });

  it("reports diagnostic when config content is not an object", () => {
    writeFileSync(join(agentDir, "agent.json"), JSON.stringify(["engineer"]));
    const result = loadAgentConfig({
      agentDir,
      cwd: projectDir,
      trusted: true,
    });
    expect(result.default).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toContain("must be a JSON object");
  });

  it("finds project config by walking up directories", () => {
    const workspaceRoot = join(baseDir, "workspace");
    mkdirSync(join(workspaceRoot, ".pi"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".pi", "agent.json"),
      JSON.stringify({ default: "scout" }),
    );

    const found = findProjectAgentConfigFile(projectDir);
    expect(found).toBe(join(workspaceRoot, ".pi", "agent.json"));
  });
});
