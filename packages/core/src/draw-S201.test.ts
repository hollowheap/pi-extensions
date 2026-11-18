import * as agentsModule from "@hollowheap/core/agents";
import { renderAgentRoster } from "@hollowheap/core/agents";
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

  it("S201 C02: agent resolution trims input and ignores sentinel names", () => {
    const resolveAgentName = (
      agentsModule as unknown as Record<string, unknown>
    ).resolveAgentName as (name: string, agents: Agent[]) => Agent | undefined;
    const agents: Agent[] = [
      { name: "Scout", description: "Fast recon" },
      { name: "writer", description: "Drafts" },
    ];
    expect(resolveAgentName("  scout  ", agents)?.name).toBe("Scout");
    expect(resolveAgentName("WRITER", agents)?.name).toBe("writer");
    expect(resolveAgentName("default", agents)).toBeUndefined();
    expect(resolveAgentName("none", agents)).toBeUndefined();
    expect(resolveAgentName("missing", agents)).toBeUndefined();
  });

  it("S201 C03: a failed flush leaves the flusher dirty for a retry", () => {
    const createDirtyFlusher = (
      stateModule as unknown as Record<string, unknown>
    ).createDirtyFlusher as () => DirtyFlusher;
    const flusher = createDirtyFlusher();
    flusher.markDirty();
    const failing = vi.fn(() => {
      throw new Error("disk full");
    });
    expect(() => flusher.flush(failing)).toThrow("disk full");

    const retry = vi.fn();
    flusher.flush(retry);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("S201 C04: the core roster renderer feeds the core resolver", () => {
    const resolveAgentName = (
      agentsModule as unknown as Record<string, unknown>
    ).resolveAgentName as (name: string, agents: Agent[]) => Agent | undefined;
    const agents: Agent[] = [{ name: "Scout", description: "Fast recon" }];
    const roster = renderAgentRoster(agents);
    expect(roster).toContain("Scout");
    expect(resolveAgentName("scout", agents)?.name).toBe("Scout");
  });
});
