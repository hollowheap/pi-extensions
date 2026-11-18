import { describe, expect, it } from "vitest";
import {
  CAPS_ENV,
  SOCKET_ENV,
  ensureEnvironment,
  piRpcArgs,
} from "./pi-rpc.js";

describe("S17: spawned pi command line", () => {
  it("includes -nbt alongside -ne and the bundled extension after -e", () => {
    const args = piRpcArgs({
      cwd: "/tmp/work",
      socketPath: "/tmp/s.sock",
      caps: "{}",
      extensionPath: "/tmp/ext.ts",
      appendix: "appendix",
      onEvent: () => {},
    });
    expect(args).toContain("-nbt");
    expect(args).toContain("-ne");
    expect(args[args.indexOf("-e") + 1]).toBe("/tmp/ext.ts");
    expect(args).not.toContain("--session");
  });
});

describe("S17: optional flags, empty values and spawn environment", () => {
  const base = {
    cwd: "/tmp/work",
    socketPath: "/tmp/s.sock",
    caps: "{}",
    extensionPath: "/tmp/ext.ts",
    appendix: "appendix",
    onEvent: () => {},
  };

  it("S17 C02: model and session flags appear only when supplied", () => {
    const plain = piRpcArgs(base);
    expect(plain).not.toContain("--model");
    expect(plain).not.toContain("--session");
    const withOptions = piRpcArgs({
      ...base,
      model: "provider/model",
      sessionFile: "/tmp/session.jsonl",
    });
    expect(withOptions[withOptions.indexOf("--model") + 1]).toBe(
      "provider/model",
    );
    expect(withOptions[withOptions.indexOf("--session") + 1]).toBe(
      "/tmp/session.jsonl",
    );
  });

  it("S17 C03: an empty model is omitted while an empty session path is passed", () => {
    const args = piRpcArgs({ ...base, model: "", sessionFile: "" });
    expect(args).not.toContain("--model");
    expect(args[args.indexOf("--session") + 1]).toBe("");
  });

  it("S17 C04: the spawn environment carries the socket and capabilities values", () => {
    const env = ensureEnvironment({
      [SOCKET_ENV]: "/tmp/x.sock",
      [CAPS_ENV]: '{"fs":{}}',
    });
    expect(env[SOCKET_ENV]).toBe("/tmp/x.sock");
    expect(env[CAPS_ENV]).toBe('{"fs":{}}');
  });
});
