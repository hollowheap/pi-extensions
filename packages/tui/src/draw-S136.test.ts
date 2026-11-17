import { describe, expect, it } from "vitest";
import { createWorkingIndicator } from "./spinner.js";

describe("S136 animated working indicator", () => {
  it("provides animated frames for braille and no frames when hidden", () => {
    const animated = createWorkingIndicator("braille", undefined, false);
    const hidden = createWorkingIndicator("hidden", undefined, false);

    expect(animated?.frames.length).toBeGreaterThan(1);
    expect(new Set(animated?.frames).size).toBeGreaterThan(1);
    expect(animated?.intervalMs).toBeGreaterThan(0);
    expect(hidden?.frames).toEqual([]);
  });
});
