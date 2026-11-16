import { describe, expect, it, vi } from "vitest";
import {
  type ClientRequest,
  FS_TIMEOUT_MS,
  createClientTerminal,
  killClientTerminal,
  readClientFile,
  readClientTerminal,
  releaseClientTerminal,
  requestPermission,
  withTimeout,
  writeClientFile,
} from "./client-requests.js";

function scriptedClient(
  handler: (method: string, params: unknown) => unknown,
): { client: ClientRequest; calls: { method: string; params: unknown }[] } {
  const calls: { method: string; params: unknown }[] = [];
  const client: ClientRequest = async (method, params) => {
    calls.push({ method, params });
    return handler(method, params);
  };
  return { client, calls };
}

describe("client requests", () => {
  it("fixes the fs and terminal timeout at ten seconds", () => {
    expect(FS_TIMEOUT_MS).toBe(10_000);
  });

  it("resolves fast work and rejects slow work", async () => {
    await expect(withTimeout(Promise.resolve("ok"), "m", 50)).resolves.toBe(
      "ok",
    );
    await expect(
      withTimeout(new Promise(() => {}), "slow-method", 20),
    ).rejects.toThrow("slow-method timed out");
  });

  it("maps permission outcomes", async () => {
    const allow = scriptedClient(() => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    await expect(
      requestPermission(allow.client, "s", {
        toolCallId: "t",
        title: "read x",
        kind: "read",
      }),
    ).resolves.toBe("allow_once");
    expect(allow.calls[0].method).toBe("session/request_permission");
    const params = allow.calls[0].params as {
      options: { optionId: string }[];
    };
    expect(params.options.map((option) => option.optionId)).toEqual([
      "allow_once",
      "reject_once",
    ]);
    const reject = scriptedClient(() => ({
      outcome: { outcome: "selected", optionId: "reject_once" },
    }));
    await expect(
      requestPermission(reject.client, "s", {
        toolCallId: "t",
        title: "read x",
        kind: "read",
      }),
    ).resolves.toBe("reject_once");
    const cancelled = scriptedClient(() => ({
      outcome: { outcome: "cancelled" },
    }));
    await expect(
      requestPermission(cancelled.client, "s", {
        toolCallId: "t",
        title: "read x",
        kind: "read",
      }),
    ).rejects.toThrow("cancelled");
  });

  it("reads and writes client files", async () => {
    const { client, calls } = scriptedClient((method) =>
      method === "fs/read_text_file" ? { content: "hello" } : {},
    );
    await expect(readClientFile(client, "s", "/x")).resolves.toBe("hello");
    await writeClientFile(client, "s", "/x", "hello");
    expect(calls.map((call) => call.method)).toEqual([
      "fs/read_text_file",
      "fs/write_text_file",
    ]);
    const bad = scriptedClient(() => ({}));
    await expect(readClientFile(bad.client, "s", "/x")).rejects.toThrow(
      "no content",
    );
  });

  it("times out file reads after ten seconds", async () => {
    vi.useFakeTimers();
    try {
      const hanging: ClientRequest = () => new Promise(() => {});
      const pending = readClientFile(hanging, "s", "/x");
      const assertion = expect(pending).rejects.toThrow(
        "fs/read_text_file timed out",
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("drives client terminals", async () => {
    const { client, calls } = scriptedClient((method) => {
      if (method === "terminal/create") return { terminalId: "t1" };
      if (method === "terminal/output")
        return { output: "out", exitStatus: { exitCode: 0 } };
      return {};
    });
    const id = await createClientTerminal(client, "s", "ls", [], "/repo");
    expect(id).toBe("t1");
    await expect(readClientTerminal(client, "s", id)).resolves.toEqual({
      output: "out",
      exitCode: 0,
    });
    await releaseClientTerminal(client, "s", id);
    await killClientTerminal(client, "s", id);
    expect(calls.map((call) => call.method)).toEqual([
      "terminal/create",
      "terminal/output",
      "terminal/release",
      "terminal/kill",
    ]);
  });
});
