import type { Theme, ThemeStyle } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { BUILTINS, type ComponentContext } from "./components.js";
import type { ResolvedSeparator, StatuslineConfig } from "./config.js";

export function applySeparator(
	separator: ResolvedSeparator,
	theme: Theme,
): string {
	if (
		separator.fg === undefined &&
		separator.bg === undefined &&
		separator.bold === undefined
	)
		return separator.text;
	const options: ThemeStyle = {};
	if (separator.fg !== undefined) options.fg = separator.fg;
	if (separator.bg !== undefined) options.bg = separator.bg;
	if (separator.bold !== undefined) options.bold = separator.bold;
	return theme.style(separator.text, options);
}

export function renderStatusline(
	width: number,
	config: StatuslineConfig,
	ctx: ComponentContext,
	theme: Theme,
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
			const render = BUILTINS[spec.type];
			if (!render) continue;
			const text = render(spec, ctx);
			if (text !== "") parts.push(text);
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
