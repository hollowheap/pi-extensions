import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
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

function theme(style: (text: string) => string = (text) => text): Theme {
	return { style } as unknown as Theme;
}

describe("renderStatusline", () => {
	it("pins left sections to the start and right sections to the end", () => {
		const config = defaultConfig();
		config.sections = {
			a: [{ type: "text", text: "L" }],
			z: [{ type: "text", text: "R" }],
		};
		const line = renderStatusline(10, config, ctx(), theme());
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
		expect(
			renderStatusline(20, config, ctx(), theme()).replace(/ +/g, " "),
		).toBe("a b y z");
	});

	it("renders only the left side when no right sections exist", () => {
		const config = defaultConfig();
		config.sections = { a: [{ type: "text", text: "L" }] };
		expect(renderStatusline(10, config, ctx(), theme())).toBe("L");
	});

	it("right-aligns when only right sections exist", () => {
		const config = defaultConfig();
		config.sections = { z: [{ type: "text", text: "R" }] };
		expect(renderStatusline(10, config, ctx(), theme())).toBe("         R");
	});

	it("skips empty components and empty sections", () => {
		const config = defaultConfig();
		config.sections = {
			a: [{ type: "git_branch" }, { type: "text", text: "L" }],
			m: [{ type: "git_branch" }],
			z: [{ type: "text", text: "R" }],
		};
		expect(renderStatusline(10, config, ctx({ branch: null }), theme())).toBe(
			"L        R",
		);
	});

	it("truncates narrow widths without exceeding them", () => {
		const config = defaultConfig();
		config.sections = {
			a: [{ type: "text", text: "left-long" }],
			z: [{ type: "text", text: "right-long" }],
		};
		const line = renderStatusline(8, config, ctx(), theme());
		expect(visibleWidth(line)).toBeLessThanOrEqual(8);
	});

	it("styles separators through the theme", () => {
		const config = defaultConfig();
		config.sections = {
			a: [
				{ type: "text", text: "L1" },
				{ type: "text", text: "L2" },
			],
			b: [{ type: "text", text: "B" }],
			z: [{ type: "text", text: "R" }],
		};
		config.options.componentSeparator = { text: "|", fg: "dim" };
		config.options.sectionSeparator = {
			text: " / ",
			bg: "selectedBg",
			bold: true,
		};
		const style = vi.fn((text: string) => `[${text}]`);
		const line = renderStatusline(40, config, ctx(), theme(style));
		expect(style).toHaveBeenCalledWith("|", { fg: "dim" });
		expect(style).toHaveBeenCalledWith(" / ", {
			bg: "selectedBg",
			bold: true,
		});
		expect(line).toContain("[|]");
		expect(line).toContain("[ / ]");
	});

	it("skips theme styling for plain separators", () => {
		const config = defaultConfig();
		config.sections = {
			a: [
				{ type: "text", text: "L1" },
				{ type: "text", text: "L2" },
			],
			z: [{ type: "text", text: "R" }],
		};
		const style = vi.fn((text: string) => `[${text}]`);
		renderStatusline(40, config, ctx(), theme(style));
		expect(style).not.toHaveBeenCalled();
	});
});
