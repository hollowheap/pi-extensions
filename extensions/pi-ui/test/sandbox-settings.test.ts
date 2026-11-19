import { describe, expect, it } from "vitest";
import { formatBwrapProbeStatus } from "../src/sandbox-settings.js";

describe("formatBwrapProbeStatus", () => {
  it("describes an available binary", () => {
    expect(
      formatBwrapProbeStatus({ available: true, path: "/usr/bin/bwrap" }),
    ).toBe("available (/usr/bin/bwrap)");
  });

  it("describes each failure reason", () => {
    expect(
      formatBwrapProbeStatus({
        available: false,
        reason: "permission",
        path: "/usr/bin/bwrap",
      }),
    ).toBe("OS permission error (/usr/bin/bwrap — check permissions)");
    expect(
      formatBwrapProbeStatus({ available: false, reason: "unsupported" }),
    ).toBe("unsupported (Linux user namespaces required)");
    expect(
      formatBwrapProbeStatus({ available: false, reason: "missing" }),
    ).toBe("missing ('bwrap' not found on PATH)");
  });
});
