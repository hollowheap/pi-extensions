import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { styleComponent, styleText } from "./colors.js";
import { BUILTINS, type ComponentContext } from "./components.js";
import type { ResolvedSeparator, StatuslineConfig } from "./config.js";

const EMPTY_VALUES: ReadonlyMap<string, string> = new Map();

export function applySeparator(
  separator: ResolvedSeparator,
  theme: Theme,
): string {
  return styleText(separator.text, separator, theme);
}

export function renderStatusline(
  width: number,
  config: StatuslineConfig,
  ctx: ComponentContext,
  theme: Theme,
  extensions: ReadonlyMap<string, string> = EMPTY_VALUES,
): string {
  const componentSeparator = applySeparator(
    config.options.componentSeparator,
    theme,
  );
  const sectionSeparator = applySeparator(
    config.options.sectionSeparator,
    theme,
  );
  const left: string[] = [];
  const right: string[] = [];
  for (const key of Object.keys(config.sections).sort()) {
    const parts: string[] = [];
    for (const spec of config.sections[key]) {
      const builtin = BUILTINS[spec.type];
      if (builtin) {
        const text = builtin(spec, ctx);
        if (text !== "") parts.push(styleComponent(text, spec, theme));
      } else if (config.extensions.includes(spec.type)) {
        const text = extensions.get(spec.type) ?? "";
        if (text !== "") parts.push(styleText(text, spec, theme));
      }
    }
    if (parts.length === 0) continue;
    const section = parts.join(componentSeparator);
    if (key < "n") left.push(section);
    else right.push(section);
  }
  const leftText = left.join(sectionSeparator);
  const rightText = right.join(sectionSeparator);
  if (rightText === "") return truncateToWidth(leftText, width);
  if (leftText === "") {
    const pad = width - visibleWidth(rightText);
    return pad <= 0
      ? truncateToWidth(rightText, width)
      : `${" ".repeat(pad)}${rightText}`;
  }
  const gap = width - visibleWidth(leftText) - visibleWidth(rightText);
  if (gap < 1) return truncateToWidth(`${leftText} ${rightText}`, width);
  return `${leftText}${" ".repeat(gap)}${rightText}`;
}
