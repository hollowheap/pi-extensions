import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTINS } from "./components.js";

export interface ComponentSpec {
	type: string;
	[option: string]: unknown;
}

export interface LualineOptions {
	componentSeparator: string;
	sectionSeparator: string;
	gitIntervalMs: number;
}

export interface LualineConfig {
	options: LualineOptions;
	sections: Record<string, ComponentSpec[]>;
}

export const CONFIG_FILE_NAME = "lualine.json";

export function defaultOptions(): LualineOptions {
	return {
		componentSeparator: " ",
		sectionSeparator: "  ",
		gitIntervalMs: 5000,
	};
}

export function defaultConfig(): LualineConfig {
	return {
		options: defaultOptions(),
		sections: {
			a: [{ type: "mode" }],
			b: [{ type: "git_branch" }, { type: "cwd" }],
			y: [{ type: "tokens" }, { type: "context" }],
			z: [{ type: "model" }, { type: "clock" }],
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringOption(
	source: Record<string, unknown>,
	key: string,
	config: LualineOptions,
	option: "componentSeparator" | "sectionSeparator",
	diagnostics: string[],
): void {
	const value = source[key];
	if (value === undefined) return;
	if (typeof value === "string") config[option] = value;
	else diagnostics.push(`options.${key} must be a string; using default`);
}

export function normalizeConfig(input: unknown): {
	config: LualineConfig;
	diagnostics: string[];
} {
	const diagnostics: string[] = [];
	const config = defaultConfig();
	if (!isRecord(input)) {
		if (input !== undefined)
			diagnostics.push("config root must be an object; using defaults");
		return { config, diagnostics };
	}
	const options = input.options;
	if (options !== undefined) {
		if (!isRecord(options)) {
			diagnostics.push("options must be an object; using defaults");
		} else {
			readStringOption(
				options,
				"componentSeparator",
				config.options,
				"componentSeparator",
				diagnostics,
			);
			readStringOption(
				options,
				"sectionSeparator",
				config.options,
				"sectionSeparator",
				diagnostics,
			);
			const interval = options.gitIntervalMs;
			if (interval !== undefined) {
				if (
					typeof interval === "number" &&
					Number.isFinite(interval) &&
					interval > 0
				) {
					config.options.gitIntervalMs = interval;
				} else {
					diagnostics.push(
						"options.gitIntervalMs must be a positive number; using default",
					);
				}
			}
		}
	}
	const sections = input.sections;
	if (sections === undefined) return { config, diagnostics };
	if (!isRecord(sections)) {
		diagnostics.push("sections must be an object; using defaults");
		return { config, diagnostics };
	}
	const normalized: Record<string, ComponentSpec[]> = {};
	for (const [key, value] of Object.entries(sections)) {
		if (!/^[a-z]$/.test(key)) {
			diagnostics.push(
				`ignoring sections.${key}: key must be a single letter a-z`,
			);
			continue;
		}
		if (!Array.isArray(value)) {
			diagnostics.push(
				`ignoring sections.${key}: must be an array of components`,
			);
			continue;
		}
		const specs: ComponentSpec[] = [];
		for (const item of value) {
			if (!isRecord(item) || typeof item.type !== "string") {
				diagnostics.push(
					`ignoring entry in sections.${key}: each component needs a string "type"`,
				);
				continue;
			}
			if (!(item.type in BUILTINS)) {
				diagnostics.push(
					`ignoring unknown component type "${item.type}" in sections.${key}`,
				);
				continue;
			}
			specs.push({ ...item, type: item.type });
		}
		normalized[key] = specs;
	}
	config.sections = normalized;
	return { config, diagnostics };
}

export function loadConfig(agentDir: string): {
	config: LualineConfig;
	diagnostics: string[];
	path: string;
} {
	const path = join(agentDir, CONFIG_FILE_NAME);
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return { config: defaultConfig(), diagnostics: [], path };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			config: defaultConfig(),
			diagnostics: [`${path} is not valid JSON; using defaults`],
			path,
		};
	}
	const { config, diagnostics } = normalizeConfig(parsed);
	return { config, diagnostics, path };
}
