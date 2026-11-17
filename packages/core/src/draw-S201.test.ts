import * as agentsModule from "@hollowheap/core/agents";
import * as stateModule from "@hollowheap/core/state";
import { describe, expect, it, vi } from "vitest";

interface Agent {
  name: string;
  description: string;
}

interface DirtyFlusher {
  flush(write: () => void): void;
  markDirty(): void;
}

describe("S201 shared primitives in owning packages", () => {
  it("resolves an agent name in the core frontmatter module", () => {
    const rawResolveAgentName = (
      agentsModule as unknown as Record<string, unknown>
    ).resolveAgentName;
    expect(rawResolveAgentName).toBeTypeOf("function");
    const resolveAgentName = rawResolveAgentName as (
      name: string,
      agents: Agent[],
    ) => Agent | undefined;

    const agents: Agent[] = [
      { name: "Scout", description: "Fast recon" },
      { name: "writer", description: "Drafts" },
    ];

    expect(resolveAgentName("scout", agents)?.name).toBe("Scout");
    expect(resolveAgentName("SCOUT", agents)?.name).toBe("Scout");
    expect(resolveAgentName("default", agents)).toBeUndefined();
    expect(resolveAgentName("none", agents)).toBeUndefined();
  });

  it("provides a reusable dirty-state flush helper in core", () => {
    const rawCreateDirtyFlusher = (
      stateModule as unknown as Record<string, unknown>
    ).createDirtyFlusher;
    expect(rawCreateDirtyFlusher).toBeTypeOf("function");
    const createDirtyFlusher = rawCreateDirtyFlusher as () => DirtyFlusher;

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
