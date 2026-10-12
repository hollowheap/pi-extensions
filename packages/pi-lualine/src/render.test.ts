import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { ComponentContext } from "./components.js";
import { defaultConfig } from "./config.js";
import { renderStatusline } from "./render.js";

function ctx(overrides: Partial<ComponentContext> = {}): ComponentContext {
	return {
		cwd: "/home/u/app",
		homeDir: "/home/u",
		modelId: "m",
		branch: "main",
		tokens: { input: 0, output: 0, cost: 0 },
		contextPercent: null,
		busy: false,
		now: new Date(2026, 9, 12, 12, 0, 0),
		gitDiff: undefined,
		...overrides,
	};
}

describe("renderStatusline", () => {
	it("pins left sections to the start and right sections to the end", () => {
		const config = defaultConfig();
		config.sections = {
			a: [{ type: "text", text: "L" }],
			z: [{ type: "text", text: "R" }],
		};
		const line = renderStatusline(10, config, ctx());
		expect(line).toBe("L        R");
		expect(visibleWidth(line)).toBe(10);
	});

	it("orders sections alphabetically within each side", () => {
		const config = defaultConfig();
		config.sections = {
			b: [{ type: "text", text: "b" }],
			a: [{ type: "text", text: "a" }],
			z: [{ type: "text", text: "z" }],
			y: [{ type: "text", text: "y" }],
		};
		expect(renderStatusline(20, config, ctx()).replace(/ +/g, " ")).toBe(
			"a b y z",
		);
	});

	it("renders only the left side when no right sections exist", () => {
		const config = defaultConfig();
		config.sections = { a: [{ type: "text", text: "L" }] };
		expect(renderStatusline(10, config, ctx())).toBe("L");
	});

	it("right-aligns when only right sections exist", () => {
		const config = defaultConfig();
		config.sections = { z: [{ type: "text", text: "R" }] };
		expect(renderStatusline(10, config, ctx())).toBe("         R");
	});

	it("skips empty components and empty sections", () => {
		const config = defaultConfig();
		config.sections = {
			a: [{ type: "git_branch" }, { type: "text", text: "L" }],
			m: [{ type: "git_branch" }],
			z: [{ type: "text", text: "R" }],
		};
		expect(renderStatusline(10, config, ctx({ branch: null }))).toBe(
			"L        R",
		);
	});

	it("truncates narrow widths without exceeding them", () => {
		const config = defaultConfig();
		config.sections = {
			a: [{ type: "text", text: "left-long" }],
			z: [{ type: "text", text: "right-long" }],
		};
		const line = renderStatusline(8, config, ctx());
		expect(visibleWidth(line)).toBeLessThanOrEqual(8);
	});
});
