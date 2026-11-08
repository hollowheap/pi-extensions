const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const {
  chmodSync,
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} = require("node:fs");
const { dirname, join } = require("node:path");

const [metaPath, logPath, cwd, shellBin, command] = process.argv.slice(1);

function readStartTime(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return undefined;
    const fields = stat
      .slice(closeParen + 2)
      .trim()
      .split(/\s+/);
    const value = Number.parseInt(fields[19] ?? "", 10);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function updateMeta(patch) {
  try {
    const raw = JSON.parse(readFileSync(metaPath, "utf8"));
    if (raw.status === "cancelled" && patch.status !== "cancelled") return;
    const next = { ...raw, ...patch };
    const tmp = join(
      dirname(metaPath),
      `.${raw.id}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
    );
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {}
    renameSync(tmp, metaPath);
  } catch {}
}

let logFd;
try {
  logFd = openSync(logPath, "a", 0o600);
  try {
    chmodSync(logPath, 0o600);
  } catch {}
} catch {
  updateMeta({ status: "failed", exitCode: null, finishedAt: Date.now() });
  process.exit(1);
}

const selfStart = readStartTime(process.pid);
updateMeta({
  pid: process.pid,
  ...(selfStart !== undefined ? { startTime: selfStart } : {}),
});

const child = spawn(shellBin, ["-c", command], {
  cwd,
  detached: true,
  stdio: ["ignore", logFd, logFd],
});

let cancelled = false;

function signalChildGroup(signal) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
    return;
  } catch {}
  try {
    process.kill(child.pid, signal);
  } catch {}
}

function isChildGroupAlive() {
  if (child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === "EPERM");
  }
}

const forwardSignal = (signal) => {
  cancelled = true;
  signalChildGroup(signal);
};
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
process.on("SIGINT", () => forwardSignal("SIGINT"));

child.on("error", (error) => {
  try {
    writeFileSync(logFd, `${error?.message ? error.message : String(error)}\n`);
  } catch {}
  try {
    closeSync(logFd);
  } catch {}
  updateMeta({ status: "failed", exitCode: null, finishedAt: Date.now() });
  process.exit(1);
});

child.on("close", (code, sig) => {
  signalChildGroup("SIGTERM");
  const finalize = () => {
    if (isChildGroupAlive()) {
      signalChildGroup("SIGKILL");
    }
    try {
      closeSync(logFd);
    } catch {}
    const exitCode = typeof code === "number" ? code : null;
    const status =
      cancelled || sig === "SIGTERM" || sig === "SIGINT"
        ? "cancelled"
        : exitCode === 0
          ? "completed"
          : "failed";
    updateMeta({ status, exitCode, finishedAt: Date.now() });
    process.exit(0);
  };
  if (!isChildGroupAlive()) {
    finalize();
    return;
  }
  const deadline = Date.now() + 200;
  const poll = () => {
    if (!isChildGroupAlive() || Date.now() >= deadline) {
      finalize();
      return;
    }
    setTimeout(poll, 20);
  };
  setTimeout(poll, 20);
});
