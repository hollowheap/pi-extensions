import { resolveAgentName } from "@hollowheap/core/agents";
import { createDirtyFlusher } from "@hollowheap/core/state";
import { describe, expect, it, vi } from "vitest";

describe("S201 shared primitives in owning packages", () => {
  it("resolves an agent name in the core frontmatter module", () => {
    const agents = [
      { name: "Scout", description: "Fast recon" },
      { name: "writer", description: "Drafts" },
    ];

    expect(resolveAgentName("scout", agents)?.name).toBe("Scout");
    expect(resolveAgentName("SCOUT", agents)?.name).toBe("Scout");
    expect(resolveAgentName("default", agents)).toBeUndefined();
    expect(resolveAgentName("none", agents)).toBeUndefined();
  });

  it("provides a reusable dirty-state flush helper in core", () => {
    const flusher = createDirtyFlusher();
    const write = vi.fn();

    flusher.flush(write);
    expect(write).not.toHaveBeenCalled();

    flusher.markDirty();
    flusher.flush(write);
    expect(write).toHaveBeenCalledTimes(1);

    flusher.flush(write);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
