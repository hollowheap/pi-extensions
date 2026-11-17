import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_FILE_NAME, findServer, loadLanguageToolsConfig } from "./config.js";

describe("S65: user language-tools.json overlays built-ins and drops malformed entries", () => {
  it("overlays a built-in server and finds it for the configured suffix", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-lang-tools-draw-"));
    const path = join(dir, CONFIG_FILE_NAME);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({
      servers: {
        mine: {
          command: "my-ls",
          args: ["--stdio"],
          extensions: { ".mine": "mine" },
          timeoutMs: 2_000,
        },
        typescript: {
          command: "my-ts-ls",
          args: ["--stdio"],
          extensions: { ".ts": "typescript" },
        },
      },
    }));
    const time = new Date(1_000);
    utimesSync(path, time, time);

    const config = loadLanguageToolsConfig(dir);
    expect(config.diagnostics).toEqual([]);
    expect(config.servers[0]).toMatchObject({ name: "mine", source: "config", timeoutMs: 2_000 });
    expect(config.servers.filter((s) => s.name === "typescript")).toHaveLength(1);
    expect(findServer(config, "file.ts")?.server.command).toBe("my-ts-ls");
    expect(findServer(config, "file.mine")?.languageId).toBe("mine");
  });
});
