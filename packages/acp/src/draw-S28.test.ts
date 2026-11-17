import { describe, expect, it } from "vitest";
import { modeOption } from "./adapter.js";

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
