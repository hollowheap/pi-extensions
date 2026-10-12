import { execFile } from "node:child_process";
import type { ComponentSpec } from "./config.js";

export interface GitDiffSummary {
	added: number;
	modified: number;
	removed: number;
	untracked: number;
}

export interface TokenTotals {
	input: number;
	output: number;
	cost: number;
}

export interface ComponentContext {
	cwd: string;
	homeDir: string;
	modelId: string | undefined;
	branch: string | null;
	tokens: TokenTotals;
	contextPercent: number | null;
	busy: boolean;
	now: Date;
	gitDiff: GitDiffSummary | undefined;
}

export type ComponentFn = (
	spec: ComponentSpec,
	ctx: ComponentContext,
) => string;

function optString(spec: ComponentSpec, key: string, fallback: string): string {
	const value = spec[key];
	return typeof value === "string" ? value : fallback;
}

function optNumber(spec: ComponentSpec, key: string): number | undefined {
	const value = spec[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function optBool(spec: ComponentSpec, key: string, fallback: boolean): boolean {
	const value = spec[key];
	return typeof value === "boolean" ? value : fallback;
}

export function formatCount(n: number): string {
	if (n < 1000) return `${n}`;
	const k = n / 1000;
	return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
}

export function formatClock(now: Date, format: string): string {
	const pad = (n: number): string => `${n}`.padStart(2, "0");
	return format
		.replace("YYYY", `${now.getFullYear()}`)
		.replace("MM", pad(now.getMonth() + 1))
		.replace("DD", pad(now.getDate()))
		.replace("HH", pad(now.getHours()))
		.replace("mm", pad(now.getMinutes()))
		.replace("ss", pad(now.getSeconds()));
}

export function shortenPath(
	path: string,
	homeDir: string,
	depth: number | undefined,
): string {
	let prefix = "";
	let rest = path;
	if (homeDir !== "" && (rest === homeDir || rest.startsWith(`${homeDir}/`))) {
		prefix = "~";
		rest = rest.slice(homeDir.length);
	}
	if (depth === undefined || depth <= 0) return `${prefix}${rest}`;
	const parts = rest.split("/").filter((part) => part !== "");
	if (parts.length <= depth) return `${prefix}${rest}`;
	return `${prefix}/…/${parts.slice(-depth).join("/")}`;
}

const mode: ComponentFn = (spec, ctx) =>
	ctx.busy
		? optString(spec, "workingText", "WORKING")
		: optString(spec, "idleText", "IDLE");

const cwd: ComponentFn = (spec, ctx) =>
	shortenPath(
		ctx.cwd,
		optBool(spec, "homeAsTilde", true) ? ctx.homeDir : "",
		optNumber(spec, "depth"),
	);

const gitBranch: ComponentFn = (spec, ctx) =>
	ctx.branch === null ? "" : `${optString(spec, "icon", "")}${ctx.branch}`;

const gitDiff: ComponentFn = (spec, ctx) => {
	if (!ctx.gitDiff) return "";
	const parts: string[] = [];
	if (ctx.gitDiff.added > 0)
		parts.push(`${optString(spec, "addedIcon", "+")}${ctx.gitDiff.added}`);
	if (ctx.gitDiff.modified > 0)
		parts.push(
			`${optString(spec, "modifiedIcon", "~")}${ctx.gitDiff.modified}`,
		);
	if (ctx.gitDiff.removed > 0)
		parts.push(`${optString(spec, "removedIcon", "-")}${ctx.gitDiff.removed}`);
	if (ctx.gitDiff.untracked > 0)
		parts.push(
			`${optString(spec, "untrackedIcon", "?")}${ctx.gitDiff.untracked}`,
		);
	return parts.join(" ");
};

const model: ComponentFn = (spec, ctx) => {
	if (!ctx.modelId) return "";
	if (!optBool(spec, "shorten", true)) return ctx.modelId;
	const slash = ctx.modelId.lastIndexOf("/");
	return slash >= 0 ? ctx.modelId.slice(slash + 1) : ctx.modelId;
};

const tokens: ComponentFn = (spec, ctx) => {
	const parts: string[] = [];
	if (optBool(spec, "showInput", true))
		parts.push(`↑${formatCount(ctx.tokens.input)}`);
	if (optBool(spec, "showOutput", true))
		parts.push(`↓${formatCount(ctx.tokens.output)}`);
	return parts.join(" ");
};

const cost: ComponentFn = (spec, ctx) => {
	const decimals = optNumber(spec, "decimals") ?? 3;
	const clamped = Math.min(Math.max(Math.trunc(decimals), 0), 6);
	return `${optString(spec, "prefix", "$")}${ctx.tokens.cost.toFixed(clamped)}`;
};

const context: ComponentFn = (_spec, ctx) =>
	ctx.contextPercent === null ? "" : `${Math.round(ctx.contextPercent)}%`;

const clock: ComponentFn = (spec, ctx) =>
	formatClock(ctx.now, optString(spec, "format", "HH:mm"));

const text: ComponentFn = (spec) => optString(spec, "text", "");

export const BUILTINS: Record<string, ComponentFn> = {
	mode,
	cwd,
	git_branch: gitBranch,
	git_diff: gitDiff,
	model,
	tokens,
	cost,
	context,
	clock,
	text,
};

export function clockIntervalMs(
	sections: Record<string, ComponentSpec[]>,
): number | undefined {
	let interval: number | undefined;
	for (const specs of Object.values(sections)) {
		for (const spec of specs) {
			if (spec.type !== "clock") continue;
			const format = typeof spec.format === "string" ? spec.format : "HH:mm";
			const explicit =
				typeof spec.intervalMs === "number" &&
				Number.isFinite(spec.intervalMs) &&
				spec.intervalMs > 0
					? spec.intervalMs
					: undefined;
			const next = explicit ?? (format.includes("ss") ? 1000 : 15000);
			interval = interval === undefined ? next : Math.min(interval, next);
		}
	}
	return interval;
}

export function parseGitPorcelain(porcelain: string): GitDiffSummary {
	const summary: GitDiffSummary = {
		added: 0,
		modified: 0,
		removed: 0,
		untracked: 0,
	};
	for (const line of porcelain.split("\n")) {
		if (line.startsWith("??")) {
			summary.untracked += 1;
			continue;
		}
		if (line.length < 2) continue;
		const x = line[0];
		const y = line[1];
		if (x === "A" || y === "A") summary.added += 1;
		else if (x === "D" || y === "D") summary.removed += 1;
		else if (x !== " " || y !== " ") summary.modified += 1;
	}
	return summary;
}

export type GitRunner = (cwd: string, signal: AbortSignal) => Promise<string>;

export function defaultGitRunner(
	cwd: string,
	signal: AbortSignal,
): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			["status", "--porcelain=v1", "--untracked-files=normal"],
			{ cwd, timeout: 5000, signal },
			(error, stdout) => {
				if (error) reject(error);
				else resolve(stdout);
			},
		);
	});
}

export interface GitDiffCache {
	get: (cwd: string) => GitDiffSummary | undefined;
	refresh: (cwd: string) => void;
	clear: () => void;
}

export function createGitDiffCache(
	runner: GitRunner,
	onUpdate: () => void,
	intervalMs: number,
): GitDiffCache {
	const cache = new Map<
		string,
		{ at: number; summary: GitDiffSummary | undefined }
	>();
	const inflight = new Set<string>();
	function store(cwd: string, summary: GitDiffSummary | undefined): void {
		cache.set(cwd, { at: Date.now(), summary });
		onUpdate();
	}
	function refresh(cwd: string): void {
		if (inflight.has(cwd)) return;
		inflight.add(cwd);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 6000);
		runner(cwd, controller.signal)
			.then(
				(stdout) => store(cwd, parseGitPorcelain(stdout)),
				() => store(cwd, undefined),
			)
			.finally(() => {
				clearTimeout(timer);
				inflight.delete(cwd);
			});
	}
	return {
		get(cwd: string): GitDiffSummary | undefined {
			const entry = cache.get(cwd);
			if (!entry || Date.now() - entry.at > intervalMs) refresh(cwd);
			return entry?.summary;
		},
		refresh,
		clear(): void {
			cache.clear();
		},
	};
}
