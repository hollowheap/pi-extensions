import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface GuardConfig {
  trustedRoots?: string[];
  decisions?: Record<string, "allow" | "ask" | "deny">;
}

export function getGuardConfigPath(agentDir: string): string {
  return join(agentDir, "guard.json");
}

export function loadGuardConfig(agentDir: string): GuardConfig {
  const path = getGuardConfigPath(agentDir);
  if (!existsSync(path)) {
    return { trustedRoots: [], decisions: {} };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { trustedRoots: [], decisions: {} };
    }
    const trustedRoots = Array.isArray(parsed.trustedRoots)
      ? parsed.trustedRoots.filter(
          (root: unknown): root is string =>
            typeof root === "string" && root.trim().length > 0,
        )
      : [];
    const decisions: Record<string, "allow" | "ask" | "deny"> = {};
    if (typeof parsed.decisions === "object" && parsed.decisions !== null) {
      for (const [key, value] of Object.entries(parsed.decisions)) {
        if (value === "allow" || value === "ask" || value === "deny") {
          decisions[key] = value;
        }
      }
    }
    return { trustedRoots, decisions };
  } catch {
    return { trustedRoots: [], decisions: {} };
  }
}

export function saveGuardConfig(agentDir: string, config: GuardConfig): void {
  const path = getGuardConfigPath(agentDir);
  const data = JSON.stringify(
    {
      trustedRoots: config.trustedRoots ?? [],
      decisions: config.decisions ?? {},
    },
    null,
    2,
  );
  writeFileSync(path, data, "utf-8");
}
