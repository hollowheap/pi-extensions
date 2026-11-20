import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

describe("pi-question registers a codemode tool, not a message_end parser", () => {
  it("registers one codemode question tool and restores state without a message_end handler", () => {
    const handlers: Record<string, unknown> = {};
    const pi = {
      on: vi.fn((event: string, handler: unknown) => {
        handlers[event] = handler;
        return () => {};
      }),
      registerTool: vi.fn(),
      registerMessageRenderer: vi.fn(),
      registerMarkdownTransformer: vi.fn(),
      appendEntry: vi.fn(),
      getActiveTools: vi.fn(() => []),
      getAllTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
    };

    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0];
    expect(tool.name).toBe("question");
    expect(tool.exposure).toBe("codemode");
    expect(handlers.message_end).toBeUndefined();
    expect(handlers.session_start).toBeDefined();
    expect(handlers.session_tree).toBeDefined();
  });
});

describe("lifecycle, schema, and handler seams", () => {
  function piWithTools() {
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const setActiveTools = vi.fn();
    const pi = {
      on: vi.fn(
        (event: string, handler: (event: unknown, ctx: unknown) => void) => {
          handlers[event] = handler;
          return () => {};
        },
      ),
      registerTool: vi.fn(),
      registerMessageRenderer: vi.fn(),
      registerMarkdownTransformer: vi.fn(),
      appendEntry: vi.fn(),
      getActiveTools: vi.fn(() => ["question", "bash"]),
      getAllTools: vi.fn(() => [{ name: "codemode" }]),
      setActiveTools,
    };
    extension(pi as never);
    return { pi, handlers, setActiveTools };
  }

  it("session_start swaps the question tool for codemode", () => {
    const { handlers, setActiveTools } = piWithTools();
    expect(handlers.session_start).toBeTypeOf("function");
    handlers.session_start({}, {});
    expect(setActiveTools).toHaveBeenCalledWith(["bash", "codemode"]);
  });

  it("the registered tool declares a question parameter schema", () => {
    const { pi } = piWithTools();
    const tool = pi.registerTool.mock.calls[0]?.[0] as {
      parameters?: {
        anyOf?: Array<{
          type?: string;
          properties?: Record<string, unknown>;
        }>;
      };
    };
    const variants = tool.parameters?.anyOf ?? [];
    expect(variants.some((v) => v.type === "array")).toBe(true);
    const objVariant = variants.find((v) => v.type === "object");
    expect(objVariant?.properties?.questions).toBeDefined();
    expect(objVariant?.properties?.prompt).toBeDefined();
  });

  it("session_tree restores state without touching active tools", () => {
    const { handlers, setActiveTools } = piWithTools();
    expect(handlers.session_tree).toBeTypeOf("function");
    handlers.session_tree({}, {});
    expect(setActiveTools).not.toHaveBeenCalled();
  });
});
