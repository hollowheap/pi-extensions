import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  abortSubagent,
  reconcileSubagent,
} from "../../extensions/pi-subagents/src/runner.ts";
import { SubagentStore } from "../../extensions/pi-subagents/src/state.ts";

const dir = mkdtempSync(join(tmpdir(), "probe-subagents-"));
const store = new SubagentStore(dir);
const socket = join(store.dir, "not-yet-created.sock");

// simulate the window between state write and runner socket listen
store.write({
  id: "starting-1",
  status: "starting",
  agent: "scout",
  task: "recon",
  depth: 1,
  attempt: 1,
  startedAt: Date.now(),
  pid: process.pid,
  socket,
});
const startingState = store.read("starting-1");
if (startingState === undefined) throw new Error("missing starting state");
const starting = reconcileSubagent(dir, startingState);
console.log("RECONCILED_STARTING_STATUS=", starting.status);

// live process, stale/missing socket: abort marks cancelled but leaves it alive
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
const childPid = child.pid;
if (childPid === undefined) throw new Error("spawn failed");
store.write({
  id: "live-1",
  status: "running",
  agent: "worker",
  task: "work",
  depth: 1,
  attempt: 1,
  startedAt: Date.now(),
  pid: childPid,
  socket: join(store.dir, "missing.sock"),
});
await abortSubagent(dir, "live-1");
const alive = (() => {
  try {
    process.kill(childPid, 0);
    return true;
  } catch {
    return false;
  }
})();
console.log("ABORT_STATUS=", store.read("live-1")?.status);
console.log("ABORT_PROCESS_ALIVE=", alive);
child.kill("SIGKILL");
rmSync(dir, { recursive: true, force: true });
