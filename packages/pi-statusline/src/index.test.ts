import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
	return {
		on: vi.fn(
			(_event: string, _fn: (event: never, ctx: never) => void) => () => {},
		),
	};
}

function handlers(
	pi: ReturnType<typeof createMockPi>,
): Record<string, (event: never, ctx: never) => void> {
	return Object.fromEntries(pi.on.mock.calls.map(([event, fn]) => [event, fn]));
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
	return {
		mode: "tui",
		cwd: "/home/u/app",
		model: { id: "anthropic/claude-opus-4-6" },
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => ({
			tokens: 1000,
			contextWindow: 200000,
			percent: 0.5,
		}),
		ui: { setFooter: vi.fn(), notify: vi.fn(), setStatus: vi.fn() },
		...overrides,
	};
}

function installFooter(
	pi: ReturnType<typeof createMockPi>,
	ctx: ReturnType<typeof createMockCtx>,
) {
	handlers(pi).session_start(undefined as never, ctx as never);
	expect(ctx.ui.setFooter).toHaveBeenCalledTimes(1);
	const factory = ctx.ui.setFooter.mock.calls[0][0];
	const tui = { requestRender: vi.fn() };
	const footerData = {
		getGitBranch: () => "main",
		onBranchChange: vi.fn(() => () => {}),
	};
	return factory(tui, {}, footerData);
}

describe("pi-statusline extension", () => {
	it("installs a footer on session_start in tui mode", () => {
		const pi = createMockPi();
		extension(pi as never);
		expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
		const component = installFooter(pi, createMockCtx());
		const lines = component.render(40);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("IDLE");
	});

	it("skips the footer outside tui mode", () => {
		const pi = createMockPi();
		extension(pi as never);
		const ctx = createMockCtx({ mode: "print" });
		handlers(pi).session_start(undefined as never, ctx as never);
		expect(ctx.ui.setFooter).not.toHaveBeenCalled();
	});

	it("renders branch, cwd, tokens, and model in the default config", () => {
		const pi = createMockPi();
		extension(pi as never);
		const component = installFooter(pi, createMockCtx());
		const line = component.render(80)[0] as string;
		expect(line).toContain("main");
		expect(line).toContain("claude-opus-4-6");
		expect(line).toMatch(/↑0/);
	});

	it("flips the mode component while the agent runs", () => {
		const pi = createMockPi();
		extension(pi as never);
		const ctx = createMockCtx();
		const component = installFooter(pi, ctx);
		const on = handlers(pi);
		on.agent_start(undefined as never, ctx as never);
		expect(component.render(40)[0]).toContain("WORKING");
		on.agent_settled(undefined as never, ctx as never);
		expect(component.render(40)[0]).toContain("IDLE");
	});

	it("clears the footer on session_shutdown for the owning session", () => {
		const pi = createMockPi();
		extension(pi as never);
		const ctx = createMockCtx();
		installFooter(pi, ctx);
		handlers(pi).session_shutdown(undefined as never, ctx as never);
		expect(ctx.ui.setFooter).toHaveBeenLastCalledWith(undefined);
	});
});
