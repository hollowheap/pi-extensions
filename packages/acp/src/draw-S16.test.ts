import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EXT = `${ROOT}packages/acp/src/extension/`;

describe("S16: ACP extension consumes core instead of local policy code", () => {
  it("imports core verdicts and ships no local rules, loader, bash, modes or exec module", () => {
    const entry = readFileSync(`${EXT}index.ts`, "utf8");
    expect(entry).toContain("@hollowheap/core/modes");
    expect(entry).toContain("evaluate");

    const files = readdirSync(EXT).filter((name) => name.endsWith(".ts"));
    for (const forbidden of [
      "rules.ts",
      "loader.ts",
      "bash.ts",
      "modes.ts",
      "exec.ts",
    ]) {
      expect(files).not.toContain(forbidden);
    }

    const forbiddenSymbols = new RegExp(
      `${["check", "Bash"].join("")}|${["load", "Rules"].join("")}|${["function", "decide"].join(" ")}`,
    );
    const sources = readdirSync(`${ROOT}packages/acp/src`)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(`${ROOT}packages/acp/src/${name}`, "utf8"));
    expect(sources.some((text) => forbiddenSymbols.test(text))).toBe(false);
  });
});
