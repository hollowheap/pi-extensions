import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
	return {
		on: vi.fn(
			(_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
		),
		registerTool: vi.fn(),
	};
}

type Handler = (event: never, ctx: never) => unknown;

function toolCallHandler(pi: ReturnType<typeof createMockPi>): Handler {
	const calls = pi.on.mock.calls.filter(([event]) => event === "tool_call");
	expect(calls).toHaveLength(1);
	return calls[0][1] as Handler;
}

function setupProject(rulesFile: string): {
	ctx: { cwd: string; ui: { notify: ReturnType<typeof vi.fn> } };
	call: (toolName: string, input: unknown) => unknown;
} {
	const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
	mkdirSync(join(dir, ".pi"), { recursive: true });
	writeFileSync(join(dir, ".pi", "permissions.json"), rulesFile);
	const pi = createMockPi();
	extension(pi as never);
	const handler = toolCallHandler(pi);
	const ctx = { cwd: dir, ui: { notify: vi.fn() } };
	return {
		ctx,
		call: (toolName: string, input: unknown) =>
			handler(
				{
					type: "tool_call",
					toolCallId: "1",
					toolName,
					input,
				} as never,
				ctx as never,
			),
	};
}

const EXAMPLE_RULES = JSON.stringify({
	rules: [
		"deny write *",
		"allow write artifacts/specs/*.md",
		"allow write artifacts/plan/*.md",
	],
});

describe("pi-permissions extension", () => {
	it("registers the tool_call hook and the fd/rg tools", () => {
		const pi = createMockPi();
		extension(pi as never);
		expect(pi.on).toHaveBeenCalledTimes(1);
		expect(pi.on.mock.calls[0][0]).toBe("tool_call");
		expect(pi.registerTool).toHaveBeenCalledTimes(2);
		const names = pi.registerTool.mock.calls.map(([tool]) => tool.name);
		expect(names).toEqual(["fd", "rg"]);
	});

	it("blocks src writes but allows spec and plan writes", () => {
		const { call } = setupProject(EXAMPLE_RULES);
		expect(call("write", { path: "src/x.ts" })).toEqual({
			block: true,
			reason: expect.stringContaining("denied"),
		});
		expect(call("write", { path: "artifacts/specs/a.md" })).toBeUndefined();
		expect(call("write", { path: "artifacts/plan/a.md" })).toBeUndefined();
	});

	it("gates edit as a write", () => {
		const { call } = setupProject(EXAMPLE_RULES);
		expect(call("edit", { path: "src/x.ts" })).toEqual({
			block: true,
			reason: expect.stringContaining("denied"),
		});
		expect(call("edit", { path: "artifacts/specs/a.md" })).toBeUndefined();
	});

	it("blocks escapes outside the project root", () => {
		const { call } = setupProject(EXAMPLE_RULES);
		expect(call("write", { path: "../evil.ts" })).toEqual({
			block: true,
			reason: expect.stringContaining("denied"),
		});
	});

	it("applies rules to find, grep, fd, and rg as reads", () => {
		const { call } = setupProject(EXAMPLE_RULES);
		for (const tool of ["find", "grep", "fd", "rg"]) {
			expect(call(tool, { path: "src/x.ts" })).toEqual({
				block: true,
				reason: expect.stringContaining("denied"),
			});
		}
	});

	it("allows reads covered by read rules", () => {
		const { call } = setupProject(
			JSON.stringify({
				rules: [
					{ effect: "deny", verb: "read", pattern: "*" },
					{ effect: "allow", verb: "read", pattern: "src/*" },
				],
			}),
		);
		expect(call("grep", { path: "src/x.ts" })).toBeUndefined();
		expect(call("find", { path: "other/x.ts" })).toEqual({
			block: true,
			reason: expect.stringContaining("denied"),
		});
	});

	it("checks the project root when find or grep omit the path", () => {
		const { call } = setupProject(EXAMPLE_RULES);
		expect(call("find", {})).toEqual({
			block: true,
			reason: expect.stringContaining("denied"),
		});
	});

	it("never blocks bash or unlisted tools", () => {
		const { call } = setupProject(EXAMPLE_RULES);
		expect(call("bash", { command: "echo hi > /tmp/x" })).toBeUndefined();
		expect(call("read", { path: "src/x.ts" })).toBeUndefined();
	});

	it("warns and allows everything when the rules file is missing or broken", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
		const pi = createMockPi();
		extension(pi as never);
		const handler = toolCallHandler(pi);
		const ctx = { cwd: dir, ui: { notify: vi.fn() } };
		const result = handler(
			{
				type: "tool_call",
				toolCallId: "1",
				toolName: "write",
				input: { path: "src/x.ts" },
			} as never,
			ctx as never,
		);
		expect(result).toBeUndefined();
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("no .pi/permissions.json"),
			"warning",
		);
	});

	it("denies everything when the rules file is invalid JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
		mkdirSync(join(dir, ".pi"), { recursive: true });
		writeFileSync(join(dir, ".pi", "permissions.json"), "{oops");
		const pi = createMockPi();
		extension(pi as never);
		const handler = toolCallHandler(pi);
		const ctx = { cwd: dir, ui: { notify: vi.fn() } };
		const result = handler(
			{
				type: "tool_call",
				toolCallId: "1",
				toolName: "write",
				input: { path: "src/x.ts" },
			} as never,
			ctx as never,
		);
		expect(result).toEqual({
			block: true,
			reason: expect.stringContaining("denied"),
		});
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("not valid JSON"),
			"warning",
		);
	});
});
