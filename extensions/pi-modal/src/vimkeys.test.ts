import { describe, expect, it } from "vitest";
import { formatVimKeys } from "./vimkeys.js";

describe("formatVimKeys", () => {
  it("lists the default mode keymaps", () => {
    const text = formatVimKeys();
    expect(text).toContain("Normal mode");
    expect(text).toContain("h    move left");
    expect(text).toContain("i    insert before cursor");
    expect(text).toContain("Insert mode");
    expect(text).toContain("Esc  normal mode");
    expect(text).toContain("Visual mode");
    expect(text).toContain("Command mode");
    expect(text).toContain("Search mode");
  });

  it("reflects custom insert chords", () => {
    const text = formatVimKeys({ keymaps: { insert: { jk: null } } });
    expect(text).toContain("jk   normal mode");
  });
});
