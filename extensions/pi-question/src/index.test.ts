import { getSessionSnapshot } from "@hollowheap/core/snapshot";
import { describe, expect, it, vi } from "vitest";
import { alertQuestion } from "./alerts.js";
import extension, {
  ANSWERS_TYPE,
  askQuestionFlow,
  askSingleQuestion,
  createQuestionTool,
} from "./index.js";

vi.mock("./alerts.js", () => ({ alertQuestion: vi.fn() }));

vi.mock("@hollowheap/core/prompt-lock", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    withPromptLock: vi.fn(
      (
        fn: () => unknown,
        opts?: { signal?: AbortSignal; timeoutMs?: number },
      ) => {
        if (opts?.signal?.aborted) {
          throw new Error("prompt lock: aborted");
        }
        return fn();
      },
    ),
  };
});

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

function createMockPi() {
  const handlers: Record<string, Handler> = {};
  const activeTools = ["read", "bash"];
  const allTools = [{ name: "read" }, { name: "bash" }, { name: "codemode" }];
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] = handler;
      return () => {};
    }),
    registerTool: vi.fn(),
    appendEntry: vi.fn(),
    getActiveTools: vi.fn(() => [...activeTools]),
    getAllTools: vi.fn(() => [...allTools]),
    setActiveTools: vi.fn((tools: string[]) => {
      activeTools.length = 0;
      activeTools.push(...tools);
    }),
  };
  return { pi, handlers };
}

function context(
  select: ReturnType<typeof vi.fn> = vi.fn(),
  input: ReturnType<typeof vi.fn> = vi.fn(),
  overrides: Record<string, unknown> = {},
) {
  return {
    hasUI: true,
    mode: "tui",
    ui: { select, input, custom: vi.fn() },
    ...overrides,
  };
}

function firstText(result: { content: unknown[] }): string {
  const item = result.content[0] as { text?: string } | undefined;
  return item?.text ?? "";
}

describe("pi-question extension", () => {
  it("registers question tool with codemode exposure and prompt guidelines", () => {
    const { pi } = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0];
    expect(tool.name).toBe("question");
    expect(tool.exposure).toBe("codemode");
    expect(tool.promptGuidelines).toBeDefined();
    expect(tool.promptGuidelines?.[0]).toContain("tools.question via codemode");
  });

  it("activates codemode on session_start and removes direct question exposure", () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    expect(handlers.session_start).toBeDefined();
    handlers.session_start({}, {});
    expect(pi.setActiveTools).toHaveBeenCalledWith([
      "read",
      "bash",
      "codemode",
    ]);
  });

  it("exports askSingleQuestion and askQuestionFlow", () => {
    expect(typeof askSingleQuestion).toBe("function");
    expect(typeof askQuestionFlow).toBe("function");
  });

  it("returns error result when no question prompt is provided", async () => {
    const tool = createQuestionTool();
    const result = await tool.execute(
      "call-1",
      {},
      undefined,
      undefined,
      context() as never,
    );
    expect(firstText(result)).toContain("Error: No question prompt provided.");
    expect(result.details).toEqual({ cancelled: true, answers: [] });
  });

  it("asks single question shorthand and returns formatted answer", async () => {
    const tool = createQuestionTool();
    const select = vi.fn().mockResolvedValue("Option A");
    const ctx = context(select);

    const result = await tool.execute(
      "call-1",
      { prompt: "Which option?", options: ["Option A", "Option B"] },
      undefined,
      undefined,
      ctx as never,
    );

    expect(select).toHaveBeenCalledWith(
      "Which option?",
      ["Option A", "Option B", "Write-in answer"],
      { signal: undefined, timeout: undefined },
    );
    expect(result.details).toMatchObject({
      cancelled: false,
      answers: [{ mode: "single", value: "Option A" }],
    });
    expect(firstText(result)).toBe("1. Option A");
  });

  it("asks free text question when no options are provided", async () => {
    const tool = createQuestionTool();
    const input = vi.fn().mockResolvedValue("My answer");
    const ctx = context(vi.fn(), input, { mode: "rpc" });

    const result = await tool.execute(
      "call-1",
      { prompt: "What is your name?" },
      undefined,
      undefined,
      ctx as never,
    );

    expect(input).toHaveBeenCalledWith("What is your name?", undefined, {
      signal: undefined,
      timeout: undefined,
    });
    expect(result.details).toMatchObject({
      cancelled: false,
      answers: [{ mode: "free", value: "My answer" }],
    });
    expect(firstText(result)).toBe("1. My answer");
  });

  it("handles user cancellation cleanly", async () => {
    const tool = createQuestionTool();
    const select = vi.fn().mockResolvedValue(undefined); // user dismisses dialog
    const ctx = context(select);

    const result = await tool.execute(
      "call-1",
      { prompt: "Which option?", options: ["Option A", "Option B"] },
      undefined,
      undefined,
      ctx as never,
    );

    expect(firstText(result)).toBe("Question cancelled by user.");
    expect(result.details).toMatchObject({ cancelled: true });
  });

  it("handles aborted signal", async () => {
    const tool = createQuestionTool();
    const controller = new AbortController();
    controller.abort();
    const ctx = context();

    const result = await tool.execute(
      "call-1",
      { prompt: "Which option?", options: ["Option A"] },
      controller.signal,
      undefined,
      ctx as never,
    );

    expect(firstText(result)).toBe("Question cancelled by user.");
    expect(result.details).toMatchObject({ cancelled: true });
  });

  it("asks multiple questions with array format", async () => {
    const tool = createQuestionTool();
    const select = vi
      .fn()
      .mockResolvedValueOnce("TypeScript")
      .mockResolvedValueOnce("Vitest");
    const ctx = context(select);

    const result = await tool.execute(
      "call-1",
      {
        questions: [
          { prompt: "Select language", options: ["TypeScript", "Python"] },
          { prompt: "Select test runner", options: ["Vitest", "Jest"] },
        ],
      },
      undefined,
      undefined,
      ctx as never,
    );

    expect(firstText(result)).toContain("1. TypeScript\n2. Vitest");
    expect(result.details).toMatchObject({
      cancelled: false,
      answers: [
        { mode: "single", value: "TypeScript" },
        { mode: "single", value: "Vitest" },
      ],
    });
  });

  it("persists ANSWERS_TYPE entry and updates snapshot on answers", async () => {
    const { pi } = createMockPi();
    const tool = createQuestionTool(pi as never);
    const sessionManager = { getBranch: vi.fn(() => []) };
    const select = vi.fn().mockResolvedValue("Option B");
    const ctx = context(select, vi.fn(), { sessionManager });

    await tool.execute(
      "call-1",
      { prompt: "Pick one", options: ["Option A", "Option B"] },
      undefined,
      undefined,
      ctx as never,
    );

    expect(pi.appendEntry).toHaveBeenCalledTimes(1);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      ANSWERS_TYPE,
      expect.objectContaining({
        questions: expect.arrayContaining([
          expect.objectContaining({ prompt: "Pick one" }),
        ]),
        answers: [{ mode: "single", value: "Option B" }],
        askedAt: expect.any(Number),
      }),
    );

    const snap = getSessionSnapshot(sessionManager);
    expect(snap.questions).toMatchObject({
      askedCount: 1,
      lastQuestion: "Pick one",
      lastAnswer: "Option B",
    });
  });

  it("does not persist when question is cancelled", async () => {
    const { pi } = createMockPi();
    const tool = createQuestionTool(pi as never);
    const select = vi.fn().mockResolvedValue(undefined);
    const ctx = context(select);

    await tool.execute(
      "call-1",
      { prompt: "Cancel me", options: ["Option A"] },
      undefined,
      undefined,
      ctx as never,
    );

    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it("returns an explicit no-UI result in print mode without alerting", async () => {
    vi.mocked(alertQuestion).mockClear();
    const tool = createQuestionTool();
    const select = vi.fn().mockResolvedValue(undefined);
    const ctx = context(select, vi.fn(), { mode: "print", hasUI: false });

    const result = await tool.execute(
      "call-1",
      { prompt: "Pick one", options: ["A", "B"] },
      undefined,
      undefined,
      ctx as never,
    );

    expect(firstText(result)).toMatch(/interactive/i);
    expect(result.details).toMatchObject({ cancelled: true, reason: "no-ui" });
    expect(select).not.toHaveBeenCalled();
    expect(alertQuestion).not.toHaveBeenCalled();
  });

  it("forwards the abort signal and timeout to host dialogs", async () => {
    const tool = createQuestionTool();
    const controller = new AbortController();
    const select = vi.fn().mockResolvedValue("Option A");
    const ctx = context(select);

    await tool.execute(
      "call-1",
      { prompt: "Pick one", options: ["Option A"] },
      controller.signal,
      undefined,
      ctx as never,
    );

    expect(select).toHaveBeenCalledWith(
      "Pick one",
      ["Option A", "Write-in answer"],
      { signal: controller.signal, timeout: undefined },
    );
  });

  it("forwards timeoutMs as the host dialog timeout", async () => {
    const select = vi.fn().mockResolvedValue("A");
    const ctx = context(select);

    await askSingleQuestion(
      { prompt: "Pick", mode: "single", options: ["A"], page: 1 },
      ctx as never,
      { signal: new AbortController().signal, timeoutMs: 1234 },
    );

    expect(select).toHaveBeenCalledWith("Pick", ["A", "Write-in answer"], {
      signal: expect.any(AbortSignal),
      timeout: 1234,
    });
  });

  it("dismisses a custom dialog when the signal aborts", async () => {
    const tool = createQuestionTool();
    const controller = new AbortController();
    let done = vi.fn();
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keys: unknown,
          done: unknown,
        ) => unknown,
      ) =>
        new Promise((resolve) => {
          done = vi.fn((value: unknown) => resolve(value));
          factory(
            { requestRender: vi.fn() },
            {
              fg: () => (value: string) => value,
              bold: (value: string) => value,
            },
            {},
            done,
          );
        }),
    );
    const ctx = context(vi.fn(), vi.fn(), {
      ui: { select: vi.fn(), input: vi.fn(), custom },
    });

    const pending = tool.execute(
      "call-1",
      { prompt: "Pick many", options: ["A", "B"], multi: true },
      controller.signal,
      undefined,
      ctx as never,
    );

    await vi.waitFor(() => expect(custom).toHaveBeenCalled());
    controller.abort();
    expect(done).toHaveBeenCalledWith({
      selected: [],
      writeIn: undefined,
      cancelled: true,
    });
    await pending;
  });

  it("restores count and last question/answer on session_start and session_tree", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);

    const sessionManager = {
      getBranch: vi.fn(() => [
        {
          type: "custom",
          customType: ANSWERS_TYPE,
          data: {
            questions: [{ prompt: "First question?" }],
            answers: [{ mode: "single", value: "First answer" }],
            askedAt: 1000,
          },
        },
        {
          type: "custom",
          customType: ANSWERS_TYPE,
          data: {
            questions: [{ prompt: "Second question?" }],
            answers: [{ mode: "free", value: "Second answer" }],
            askedAt: 2000,
          },
        },
      ]),
    };
    const ctx = context(vi.fn(), vi.fn(), { sessionManager });

    await handlers.session_start({}, ctx);

    let snap = getSessionSnapshot(sessionManager);
    expect(snap.questions).toMatchObject({
      askedCount: 2,
      lastQuestion: "Second question?",
      lastAnswer: "Second answer",
      updatedAt: 2000,
    });

    // session_tree restores similarly
    await handlers.session_tree({}, ctx);
    snap = getSessionSnapshot(sessionManager);
    expect(snap.questions).toMatchObject({
      askedCount: 2,
      lastQuestion: "Second question?",
      lastAnswer: "Second answer",
      updatedAt: 2000,
    });
  });
});
