import { describe, expect, it } from "vitest";
import { resolveEffectiveKeymaps } from "./keymap.js";
import { formatVimKeys } from "./vimkeys.js";

const MOTIONS = [
  "w",
  "b",
  "e",
  "0",
  "$",
  "gg",
  "G",
  "dd",
  "yy",
  "p",
  "u",
  "\x12",
];

describe("modal vim bindings", () => {
  it("S211 C01: binds common motions and operators in normal mode", () => {
    const normal = resolveEffectiveKeymaps().normal;
    for (const key of MOTIONS) {
      expect(Object.hasOwn(normal, key)).toBe(true);
    }
  });

  it("S211 C02: lists the same motions and operators in the keybind reference", () => {
    const reference = formatVimKeys();
    for (const key of MOTIONS) {
      expect(reference).toContain(key);
    }
  });
});
