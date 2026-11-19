import { describe, expect, it } from "vitest";
import { splitModelThinking } from "../src/model-ref.js";

describe("splitModelThinking", () => {
  it("splits a trailing thinking level from provider/id", () => {
    expect(splitModelThinking("opencode-go/deepseek-v4.1-flash:high")).toEqual({
      model: "opencode-go/deepseek-v4.1-flash",
      thinking: "high",
    });
  });

  it("lowercases the level and trims the input", () => {
    expect(splitModelThinking("  sonnet:XHigh ")).toEqual({
      model: "sonnet",
      thinking: "xhigh",
    });
  });

  it("leaves models without a suffix untouched", () => {
    expect(splitModelThinking("anthropic/claude-opus-5.5")).toEqual({
      model: "anthropic/claude-opus-5.5",
    });
  });

  it("keeps colons that are not thinking levels", () => {
    expect(splitModelThinking("openrouter/some-model:free")).toEqual({
      model: "openrouter/some-model:free",
    });
  });

  it("does not treat a bare leading level as a model", () => {
    expect(splitModelThinking(":high")).toEqual({ model: ":high" });
  });
});
