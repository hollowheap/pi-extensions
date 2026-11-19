import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared detached-process package boundary", () => {
  it("allows subagents to be installed with the runtime alone", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.dependencies["@hollowheap/runtime"]).toBeDefined();
    expect(manifest.dependencies["@hollowheap/pi-tasks"]).toBeUndefined();
  });
});
