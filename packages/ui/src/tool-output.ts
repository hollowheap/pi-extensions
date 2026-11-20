import {
  ToolExecutionComponent,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type { ToolVerbosity } from "@hollowheap/core/tui-config";
import { getActiveTuiConfig } from "./state.js";

const OUTPUT_POLICY = Symbol.for("@hollowheap/ui/tool-output-policy");

export function toolOutputDisplay(
  verbosity: ToolVerbosity | undefined,
  hostExpanded: boolean,
  toolName: string,
): { expanded: boolean; hideOutput: boolean } {
  return {
    expanded:
      toolName !== "codemode" &&
      (verbosity === undefined ? hostExpanded : verbosity === "high"),
    hideOutput: verbosity === "low",
  };
}

/**
 * Let Pi draw its native tool results and generic fallback at the selected verbosity.
 * Images come from the host shell after its result renderer, so hide them there at Low.
 */
export function withToolOutputDisplay(
  toolName: string,
  base: ToolRenderers | undefined,
  panel = false,
): ToolRenderers {
  const renderer: ToolRenderers = {
    ...base,
    get renderResult() {
      if (!panel && getActiveTuiConfig().toolVerbosity === "low") {
        return () => ({ render: () => [], invalidate() {} });
      }
      return base?.renderResult;
    },
  };
  Reflect.defineProperty(renderer, OUTPUT_POLICY, { value: toolName });
  installToolOutputDisplay();
  return renderer;
}

function installToolOutputDisplay(): void {
  const prototype = ToolExecutionComponent.prototype;
  if (Reflect.get(prototype, OUTPUT_POLICY)) return;
  const updateDisplay = Reflect.get(prototype, "updateDisplay") as
    | ((this: ToolExecutionComponent) => void)
    | undefined;
  if (typeof updateDisplay !== "function") return;
  Reflect.defineProperty(prototype, OUTPUT_POLICY, { value: true });
  Reflect.set(
    prototype,
    "updateDisplay",
    function (this: ToolExecutionComponent) {
      const renderer: unknown = Reflect.get(this, "toolDefinition");
      const toolName =
        typeof renderer === "object" && renderer !== null
          ? Reflect.get(renderer, OUTPUT_POLICY)
          : undefined;
      const hostExpanded: unknown = Reflect.get(this, "expanded");
      const hostImages: unknown = Reflect.get(this, "showImages");
      if (
        typeof toolName !== "string" ||
        typeof hostExpanded !== "boolean" ||
        typeof hostImages !== "boolean"
      ) {
        updateDisplay.call(this);
        return;
      }

      const display = toolOutputDisplay(
        getActiveTuiConfig().toolVerbosity,
        hostExpanded,
        toolName,
      );
      Reflect.set(this, "expanded", display.expanded);
      Reflect.set(this, "showImages", hostImages && !display.hideOutput);
      try {
        updateDisplay.call(this);
      } finally {
        Reflect.set(this, "expanded", hostExpanded);
        Reflect.set(this, "showImages", hostImages);
      }
    },
  );
}

const fixedCodemodeResults = new WeakSet<object>();
const CODEMODE_EXPANSION_HINT =
  /^(\s*\.\.\. \(\d+ (?:more lines|earlier calls)), .*\bto expand\)\s*$/;

/** Keep Pi's collapsed preview, with an omission count and no expansion hint. */
export function codemodePreview(
  base: ToolRenderers | undefined,
): ToolRenderers | undefined {
  const renderResult = base?.renderResult;
  if (!renderResult) return base;
  return {
    ...base,
    renderResult(result, options, theme, context) {
      const component = renderResult(
        result,
        { ...options, expanded: false },
        theme,
        { ...context, expanded: false },
      );
      if (!fixedCodemodeResults.has(component)) {
        fixedCodemodeResults.add(component);
        const render = component.render.bind(component);
        component.render = (width) =>
          render(width).map((line) => {
            const hint = CODEMODE_EXPANSION_HINT.exec(
              stripTerminalSequences(line),
            );
            return hint ? theme.fg("muted", `${hint[1]})`) : line;
          });
      }
      return component;
    },
  };
}
