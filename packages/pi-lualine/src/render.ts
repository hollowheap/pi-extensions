import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { BUILTINS, type ComponentContext } from "./components.js";
import type { LualineConfig } from "./config.js";

export function renderStatusline(
	width: number,
	config: LualineConfig,
	ctx: ComponentContext,
): string {
	const left: string[] = [];
	const right: string[] = [];
	for (const key of Object.keys(config.sections).sort()) {
		const parts: string[] = [];
		for (const spec of config.sections[key]) {
			const render = BUILTINS[spec.type];
			if (!render) continue;
			const text = render(spec, ctx);
			if (text !== "") parts.push(text);
		}
		if (parts.length === 0) continue;
		const section = parts.join(config.options.componentSeparator);
		if (key < "n") left.push(section);
		else right.push(section);
	}
	const leftText = left.join(config.options.sectionSeparator);
	const rightText = right.join(config.options.sectionSeparator);
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
