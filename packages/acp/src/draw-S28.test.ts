import { registerMode } from "@hollowheap/core/modes";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { describe, expect, it } from "vitest";
import { modeOption } from "./adapter.js";
import { modeDescriptors } from "./extension/index.js";

describe("S28: ACP mode list comes from the extension and notices ride in the option", () => {
  it("makes an extension-registered mode selectable and appends the notice to the active description", () => {
    const modes = [
      { name: "plan", description: "Plan mode" },
      { name: "team-custom", description: "Team mode" },
      { name: "edit", description: "Edit mode" },
    ];
    const option = modeOption(
      "team-custom",
      modes,
      "writes run without asking",
    ) as {
      options: { value: string; description: string }[];
      currentValue: string;
    };

    expect(option.options.map((entry) => entry.value)).toEqual([
      "plan",
      "team-custom",
      "edit",
    ]);
    const active = option.options.find(
      (entry) => entry.value === "team-custom",
    );
    expect(active?.description).toContain("Team mode");
    expect(active?.description).toContain("writes run without asking");
    expect(option.currentValue).toBe("team-custom");
  });
});

describe("S28: default mode list, unmatched notice and extension consumer", () => {
  it("S28 C02: with no descriptors the option lists the built-in modes", () => {
    const option = modeOption("manual") as {
      options: { value: string }[];
      currentValue: string;
    };
    expect(option.options.map((entry) => entry.value)).toEqual([
      "plan",
      "manual",
      "edit",
    ]);
    expect(option.currentValue).toBe("manual");
  });

  it("S28 C03: a notice for an unlisted mode becomes the top-level description", () => {
    const option = modeOption(
      "missing",
      [{ name: "plan", description: "Plan mode" }],
      "writes run without asking",
    ) as {
      description: string;
      options: { value: string; description: string }[];
    };
    expect(option.description).toBe("writes run without asking");
    expect(option.options[0].description).toBe("Plan mode");
  });

  it("S28 C04: extension-registered modes populate the adapter select option", () => {
    for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);
    const descriptors = modeDescriptors();
    expect(descriptors.map((entry) => entry.name)).toContain("plan");
    const option = modeOption("plan", descriptors) as {
      options: { value: string }[];
      currentValue: string;
    };
    expect(option.options.map((entry) => entry.value)).toEqual(
      descriptors.map((entry) => entry.name),
    );
    expect(option.currentValue).toBe("plan");
  });
});
