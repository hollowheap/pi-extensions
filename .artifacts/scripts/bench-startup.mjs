import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";

const runs = Number(process.env.RUNS ?? 3);

function measure(args) {
  const start = performance.now();
  const result = spawnSync("pi", args, { stdio: "ignore" });
  if (result.status !== 0) {
    throw new Error(`pi exited with ${result.status}`);
  }
  return performance.now() - start;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const extensions = readdirSync("extensions")
  .sort()
  .flatMap((name) => ["-e", `extensions/${name}/index.ts`]);
const base = Array.from({ length: runs }, () =>
  measure(["-ne", "--offline", "--list-models"]),
);
const loaded = Array.from({ length: runs }, () =>
  measure(["-ne", "--offline", "--list-models", ...extensions]),
);
const baseMs = median(base);
const loadedMs = median(loaded);
console.log(`baseline  ${baseMs.toFixed(0)} ms`);
console.log(`16 ext    ${loadedMs.toFixed(0)} ms`);
console.log(`overhead  ${(loadedMs - baseMs).toFixed(0)} ms`);
