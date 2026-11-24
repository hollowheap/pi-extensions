import {
  ToolExecutionComponent,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import {
  getActiveTuiConfig,
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "../src/state.js";
import { codemodePreview, withToolOutputDisplay } from "../src/tool-output.js";

afterEach(resetActiveTuiConfig);

function renderNative(
  toolName: string,
  verbosity: "low" | "medium" | "high",
  expanded: boolean,
) {
  initTheme("dark");
  setActiveTuiConfig({ ...getActiveTuiConfig(), toolVerbosity: verbosity });
  const definition = withToolOutputDisplay(toolName, undefined);
  const tool = new ToolExecutionComponent(
    toolName,
    "call",
    { query: "arg-value" },
    undefined,
    definition,
    {} as never,
    "/tmp",
  );
  tool.setExpanded(expanded);
  tool.updateResult({
    isError: false,
    content: [
      {
        type: "text",
        text: Array.from({ length: 15 }, (_, i) => `result-${i}`).join("\n"),
      },
      { type: "image", data: "fixture", mimeType: "image/png" },
    ],
  });
  return stripTerminalSequences(tool.render(80).join("\n"));
}

describe("native tool result display", () => {
  it("keeps the call and hides every result in Low", () => {
    const lines = renderNative("custom_tool", "low", true);
    expect(lines).toContain("custom_tool");
    expect(lines).toContain("arg-value");
    expect(lines).not.toContain("result-");
    expect(lines.toLowerCase()).not.toContain("image");
  });

  it("lets the host render the collapsed and expanded results", () => {
    const medium = renderNative("custom_tool", "medium", true);
    expect(medium).toContain("result-0");
    expect(medium).not.toContain("result-14");
    expect(renderNative("custom_tool", "high", false)).toContain("result-14");
  });

  it("shows batch tool outputs at High verbosity", () => {
    const lines = renderNative("batch", "high", true);
    expect(lines).toContain("result-0");
    expect(lines).toContain("result-14");
  });

  it("keeps codemode results collapsed in High and removes their expansion hint", () => {
    expect(renderNative("codemode", "high", true)).not.toContain("result-14");
    const renderer = codemodePreview({
      renderResult: (_result, options) => ({
        render: () =>
          options.expanded
            ? ["expanded"]
            : ["... (3 more lines, ctrl+o to expand)", "preview"],
        invalidate() {},
      }),
    });
    const result = renderer?.renderResult?.(
      { content: [] } as never,
      { expanded: true } as never,
      { fg: (_token: unknown, text: string) => text } as never,
      {} as never,
    );
    expect(result?.render(80)).toEqual(["... (3 more lines)", "preview"]);
  });
});
