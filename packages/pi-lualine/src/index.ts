import { homedir } from "node:os";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
	type GitDiffCache,
	type TokenTotals,
	clockIntervalMs,
	createGitDiffCache,
	defaultGitRunner,
} from "./components.js";
import { type LualineConfig, defaultConfig, loadConfig } from "./config.js";
import { renderStatusline } from "./render.js";

function sumTokens(ctx: ExtensionContext): TokenTotals {
	const totals: TokenTotals = { input: 0, output: 0, cost: 0 };
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message as AssistantMessage;
		if (message.role !== "assistant") continue;
		totals.input += message.usage.input;
		totals.output += message.usage.output;
		totals.cost += message.usage.cost.total;
	}
	return totals;
}

export default function (pi: ExtensionAPI) {
	let config: LualineConfig = defaultConfig();
	let busy = false;
	let diffCache: GitDiffCache = createGitDiffCache(
		defaultGitRunner,
		() => {},
		5000,
	);
	let requestRender: (() => void) | undefined;
	let cleanupFooter: (() => void) | undefined;
	let owner: ExtensionContext["sessionManager"] | undefined;

	function disposeFooter(): void {
		cleanupFooter?.();
		cleanupFooter = undefined;
		requestRender = undefined;
	}

	function installFooter(ctx: ExtensionContext): void {
		disposeFooter();
		owner = ctx.sessionManager;
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter((tui, _theme, footerData) => {
			requestRender = () => tui.requestRender();
			diffCache = createGitDiffCache(
				defaultGitRunner,
				() => requestRender?.(),
				config.options.gitIntervalMs,
			);
			const branchUnsubscribe = footerData.onBranchChange(() => {
				diffCache.refresh(ctx.cwd);
				tui.requestRender();
			});
			const clockMs = clockIntervalMs(config.sections);
			const clockTimer =
				clockMs === undefined
					? undefined
					: setInterval(() => tui.requestRender(), clockMs);
			diffCache.refresh(ctx.cwd);
			let disposed = false;
			const cleanup = () => {
				if (disposed) return;
				disposed = true;
				branchUnsubscribe();
				if (clockTimer !== undefined) clearInterval(clockTimer);
			};
			cleanupFooter = cleanup;
			return {
				dispose: cleanup,
				invalidate() {},
				render(width: number): string[] {
					const line = renderStatusline(width, config, {
						cwd: ctx.cwd,
						homeDir: homedir(),
						modelId: ctx.model?.id,
						branch: footerData.getGitBranch(),
						tokens: sumTokens(ctx),
						contextPercent: ctx.getContextUsage()?.percent ?? null,
						busy,
						now: new Date(),
						gitDiff: diffCache.get(ctx.cwd),
					});
					return line === "" ? [] : [line];
				},
			};
		});
	}

	pi.on("session_start", (_event, ctx) => {
		const loaded = loadConfig(getAgentDir());
		config = loaded.config;
		busy = false;
		if (loaded.diagnostics.length > 0) {
			ctx.ui.notify(
				`pi-lualine: ${loaded.diagnostics.slice(0, 3).join("; ")}`,
				"warning",
			);
		}
		installFooter(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		installFooter(ctx);
		requestRender?.();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.sessionManager !== owner) return;
		owner = undefined;
		disposeFooter();
		ctx.ui.setFooter(undefined);
	});

	pi.on("agent_start", (_event, ctx) => {
		if (ctx.sessionManager !== owner) return;
		busy = true;
		requestRender?.();
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.sessionManager !== owner) return;
		busy = false;
		requestRender?.();
	});

	pi.on("turn_end", (_event, ctx) => {
		if (ctx.sessionManager !== owner) return;
		diffCache.refresh(ctx.cwd);
		requestRender?.();
	});

	pi.on("tool_execution_end", (_event, ctx) => {
		if (ctx.sessionManager !== owner) return;
		diffCache.refresh(ctx.cwd);
		requestRender?.();
	});

	pi.on("model_select", () => {
		requestRender?.();
	});
}
