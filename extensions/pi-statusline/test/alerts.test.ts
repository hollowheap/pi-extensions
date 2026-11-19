import { deliverAlert } from "@hollowheap/core/alerts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@hollowheap/core/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hollowheap/core/alerts")>()),
  deliverAlert: vi.fn(),
}));

const deliver = vi.mocked(deliverAlert);
const payload = { event: "completion", status: "settled" };

function startSession() {
  const ctx = { mode: "print", cwd: process.cwd(), sessionManager: {} };
  const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
  extension({
    on: (event: string, callback: (event: unknown, ctx: unknown) => void) =>
      handlers.set(event, callback),
    events: { on: vi.fn() },
    registerCommand: vi.fn(),
  } as never);
  const emit = (event: string) => handlers.get(event)?.(undefined, ctx);
  emit("session_start");
  return emit;
}

beforeEach(() => {
  deliver.mockReset().mockResolvedValue("native");
});

describe("agent completion alerts", () => {
  it("delivers one alert whose payload contains only event and status", () => {
    const emit = startSession();
    emit("agent_settled");
    emit("agent_start");
    emit("agent_settled");
    emit("agent_settled");

    expect(deliver).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("a throwing notifier never affects the footer", async () => {
    deliver.mockRejectedValueOnce(new Error("notification failed"));
    const emit = startSession();
    emit("agent_start");
    emit("agent_settled");
    await Promise.resolve();
    emit("agent_settled");

    expect(deliver).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("separate agent completions are not deduplicated at this seam", () => {
    const emit = startSession();
    emit("agent_start");
    emit("agent_settled");
    emit("agent_start");
    emit("agent_settled");

    expect(deliver.mock.calls).toEqual([[payload], [payload]]);
  });
});
