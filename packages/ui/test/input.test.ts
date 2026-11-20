import { describe, expect, it } from "vitest";
import { decodePrintableInput } from "../src/input.js";

describe("decodePrintableInput", () => {
  it("decodes single printable characters and rejects control chars", () => {
    expect(decodePrintableInput("a")).toBe("a");
    expect(decodePrintableInput("\x1b")).toBeUndefined();
    expect(decodePrintableInput("\x7f")).toBeUndefined();
  });

  it("decodes bracketed paste payloads and strips non-printable chars", () => {
    expect(decodePrintableInput("\x1b[200~hello\nworld\x1b[201~")).toBe(
      "helloworld",
    );
    expect(decodePrintableInput("\x1b[200~unterminated")).toBeUndefined();
  });

  it("decodes modifyOtherKeys printable sequences", () => {
    expect(decodePrintableInput("\x1b[27;2;65~")).toBe("A");
    expect(decodePrintableInput("\x1b[27;5;65~")).toBeUndefined();
  });
});
