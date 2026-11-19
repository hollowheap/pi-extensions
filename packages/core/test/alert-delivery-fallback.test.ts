import { runCapture } from "@hollowheap/runtime/exec";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlertDispatcher,
  buildAlertPayload,
  deliverAlert,
} from "../src/alerts.js";

vi.mock("@hollowheap/runtime/exec", () => ({ runCapture: vi.fn() }));

const capture = vi.mocked(runCapture);

beforeEach(() => {
  capture.mockReset().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
});

describe("alert delivery fallback", () => {
  it("falls back to terminal delivery when the Linux notifier is unavailable", async () => {
    const fallback = vi.fn();
    const mode = await deliverAlert(buildAlertPayload("error"), {
      platform: "linux",
      notify: () => false,
      fallback,
    });

    expect(mode).toBe("fallback");
    expect(fallback).toHaveBeenCalledWith({ event: "error" });
  });

  it("a working Linux notifier delivers natively and skips fallback", async () => {
    const notify = vi.fn(() => true);
    const fallback = vi.fn();
    const payload = buildAlertPayload("completion");

    const mode = await deliverAlert(payload, {
      platform: "linux",
      notify,
      fallback,
    });

    expect(mode).toBe("native");
    expect(notify).toHaveBeenCalledWith(payload);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("unsupported native platforms go straight to fallback", async () => {
    const notify = vi.fn(() => true);
    const fallback = vi.fn();

    const mode = await deliverAlert(buildAlertPayload("error"), {
      platform: "freebsd",
      notify,
      fallback,
    });

    expect(mode).toBe("fallback");
    expect(notify).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("passes the macOS notification text as a separate AppleScript argument", async () => {
    const payload = buildAlertPayload("completion", undefined, 'quoted "text"');
    const fallback = vi.fn();

    expect(await deliverAlert(payload, { platform: "darwin", fallback })).toBe(
      "native",
    );
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      "osascript",
      [
        "-e",
        expect.stringContaining("display notification (item 1 of argv)"),
        'completion quoted "text"',
      ],
      process.cwd(),
      undefined,
      { timeoutMs: 5_000 },
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it("treats notification text as data in the Windows script", async () => {
    const status = "don't expand $(expression) 日本語";
    const payload = buildAlertPayload("completion", undefined, status);
    const fallback = vi.fn();

    expect(await deliverAlert(payload, { platform: "win32", fallback })).toBe(
      "native",
    );
    const [command, args] = capture.mock.calls[0];
    expect(command).toBe("powershell.exe");
    expect(args.slice(0, 3)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
    const script = Buffer.from(args[3], "base64").toString("utf16le");
    expect(script).toContain("ShowBalloonTip");
    expect(script).not.toContain(status);
    const message = /FromBase64String\('([^']+)'\)/.exec(script)?.[1];
    expect(Buffer.from(message ?? "", "base64").toString("utf8")).toBe(
      `completion ${status}`,
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(["linux", "darwin", "win32"] as const)(
    "falls back when %s native delivery exits unsuccessfully or throws",
    async (platform) => {
      capture
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
        .mockRejectedValueOnce(new Error("notifier unavailable"));
      const fallback = vi.fn();
      const payload = buildAlertPayload("question", undefined, "asked");

      expect(await deliverAlert(payload, { platform, fallback })).toBe(
        "fallback",
      );
      expect(await deliverAlert(payload, { platform, fallback })).toBe(
        "fallback",
      );
      expect(fallback.mock.calls).toEqual([[payload], [payload]]);
    },
  );

  it("the dispatcher reports a repeated event/id as duplicate", async () => {
    const fallback = vi.fn();
    const dispatcher = new AlertDispatcher();
    const payload = buildAlertPayload("question", "q-1", "asked");
    const delivery = {
      platform: "linux" as const,
      notify: () => true,
      fallback,
    };

    expect(await dispatcher.dispatch(payload, delivery)).toBe("native");
    expect(await dispatcher.dispatch(payload, delivery)).toBe("duplicate");
    expect(fallback).not.toHaveBeenCalled();
  });
});
