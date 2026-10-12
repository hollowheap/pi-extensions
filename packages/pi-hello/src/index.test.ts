import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
	return {
		registerTool: vi.fn(),
		registerCommand: vi.fn(),
		on: vi.fn(() => () => {}),
	};
}

describe("pi-hello extension", () => {
	it("registers the hello tool and /hello command", () => {
		const pi = createMockPi();
		extension(pi as never);

		expect(pi.registerTool).toHaveBeenCalledTimes(1);
		expect(pi.registerTool.mock.calls[0][0].name).toBe("hello");

		expect(pi.registerCommand).toHaveBeenCalledTimes(1);
		expect(pi.registerCommand.mock.calls[0][0]).toBe("hello");
	});

	it("hello tool greets the given name", async () => {
		const pi = createMockPi();
		extension(pi as never);

		const tool = pi.registerTool.mock.calls[0][0];
		const result = await tool.execute(
			"call-1",
			{ name: "pi" },
			undefined,
			() => {},
			undefined,
		);

		expect(result.content[0]).toMatchObject({ text: "Hello, pi!" });
		expect(result.details).toEqual({ greeted: "pi" });
	});

	it("/hello notifies with a default", async () => {
		const pi = createMockPi();
		extension(pi as never);

		const [, def] = pi.registerCommand.mock.calls[0];
		const ctx = { ui: { notify: vi.fn() } };
		await def.handler("", ctx as never);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Hello, world!", "info");
	});
});
