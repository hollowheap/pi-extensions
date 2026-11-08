import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";

const configPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const LOCK_TIMEOUT_MS = 1_000;
const STALE_LOCK_MS = 2_000;
let exited = false;
let aborting = false;

const log = fs.createWriteStream(config.logPath, { flags: "a", mode: 0o600 });
try {
  fs.chmodSync(config.logPath, 0o600);
} catch {}

function writeLog(message) {
  try {
    log.write(`${message}\n`);
  } catch {}
}

function readStartTime(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return undefined;
    const fields = stat
      .slice(closeParen + 2)
      .trim()
      .split(/\s+/);
    const value = Number.parseInt(fields[19] || "", 10);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(config.statePath, "utf8"));
  } catch {
    return { id: config.id };
  }
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {}
}

function acquireStateLock() {
  const lockPath = `${config.statePath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      fs.closeSync(fs.openSync(lockPath, "wx", 0o600));
      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {}
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
        try {
          fs.unlinkSync(lockPath);
        } catch {}
        continue;
      }
    } catch {
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out acquiring subagent state lock: ${lockPath}`);
    }
    sleepSync(5);
  }
}

function update(patch) {
  let release;
  try {
    release = acquireStateLock();
    const current = readState();
    if (current.status === "cancelled" && patch.status !== "cancelled") {
      return;
    }
    const next = Object.assign({}, current, patch);
    const tmp = join(
      dirname(config.statePath),
      `.${config.id}.${process.pid}.${Date.now()}.tmp`,
    );
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600,
    });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {}
    fs.renameSync(tmp, config.statePath);
  } catch (error) {
    writeLog(`state update failed: ${String(error)}`);
  } finally {
    if (release !== undefined) release();
  }
}

if (readState().status === "cancelled") {
  writeLog("cancelled before child start");
  process.exit(0);
}

const child = spawn(config.command, config.args || [], {
  cwd: config.cwd,
  env: Object.assign({}, process.env, config.env || {}),
  detached: true,
  stdio: ["pipe", "pipe", "pipe"],
});

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

child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
child.stdin.on("error", (error) => {
  writeLog(`stdin error: ${String(error)}`);
  finish("failed", null);
});
child.stdout.on("error", (error) => {
  writeLog(`stdout error: ${String(error)}`);
});
child.stderr.on("error", (error) => {
  writeLog(`stderr error: ${String(error)}`);
});

update({
  status: "running",
  pid: child.pid,
  startTime: child.pid === undefined ? undefined : readStartTime(child.pid),
});
if (readState().status === "cancelled") {
  aborting = true;
  signalChildGroup("SIGTERM");
  setTimeout(() => {
    if (!exited || isChildGroupAlive()) {
      signalChildGroup("SIGKILL");
    }
  }, 250);
} else if (
  typeof config.initialInput === "string" &&
  config.initialInput !== ""
) {
  try {
    child.stdin.write(`${config.initialInput}\n`);
  } catch (error) {
    writeLog(`initial input error: ${String(error)}`);
  }
}

const sockets = new Set();
const server = net.createServer((socket) => {
  sockets.add(socket);
  socket.setEncoding("utf8");
  socket.on("error", () => {});
  socket.on("close", () => sockets.delete(socket));
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (line.trim() === "") continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        continue;
      }
      const id = request?.id;
      const action = request?.action;
      if (action === "send") {
        if (!child.stdin.writable || exited) {
          socket.write(
            `${JSON.stringify({ id, ok: false, error: "child is not accepting input" })}\n`,
          );
          continue;
        }
        const payload = request.payload;
        const data =
          config.inputMode === "text"
            ? typeof payload === "string"
              ? payload
              : String(payload ?? "")
            : typeof payload === "string"
              ? payload
              : JSON.stringify(payload);
        try {
          child.stdin.write(`${data}\n`);
        } catch (error) {
          socket.write(
            `${JSON.stringify({ id, ok: false, error: String(error) })}\n`,
          );
          continue;
        }
        socket.write(`${JSON.stringify({ id, ok: true })}\n`);
        continue;
      }
      if (action === "abort") {
        aborting = true;
        signalChildGroup("SIGTERM");
        setTimeout(() => {
          if (!exited || isChildGroupAlive()) {
            signalChildGroup("SIGKILL");
          }
        }, 250);
        socket.write(`${JSON.stringify({ id, ok: true })}\n`);
        continue;
      }
      if (action === "status") {
        socket.write(
          `${JSON.stringify({
            id,
            ok: true,
            payload: {
              pid: child.pid,
              alive: !exited,
              status: aborting ? "cancelled" : "running",
            },
          })}\n`,
        );
        continue;
      }
      socket.write(
        `${JSON.stringify({ id, ok: false, error: "unknown action" })}\n`,
      );
    }
  });
});

function closeServer() {
  for (const socket of sockets) socket.destroy();
  try {
    server.close(() => {});
  } catch {}
  try {
    fs.unlinkSync(config.socketPath);
  } catch {}
}

function finish(status, code) {
  if (exited) return;
  exited = true;
  signalChildGroup("SIGTERM");
  update({
    status,
    exitCode: typeof code === "number" ? code : null,
    finishedAt: Date.now(),
  });
  log.end();
  closeServer();
  const exitNow = () => {
    if (isChildGroupAlive()) {
      signalChildGroup("SIGKILL");
    }
    setTimeout(() => process.exit(0), 25);
  };
  if (!isChildGroupAlive()) {
    exitNow();
    return;
  }
  const deadline = Date.now() + 200;
  const poll = () => {
    if (!isChildGroupAlive() || Date.now() >= deadline) {
      exitNow();
      return;
    }
    setTimeout(poll, 25);
  };
  setTimeout(poll, 25);
}

child.on("error", (error) => {
  writeLog(String(error?.message ? error.message : error));
  finish("failed", null);
});
child.on("exit", (code) => {
  finish(aborting ? "cancelled" : code === 0 ? "completed" : "failed", code);
});

function terminateChild() {
  aborting = true;
  signalChildGroup("SIGTERM");
  setTimeout(() => {
    if (!exited || isChildGroupAlive()) {
      signalChildGroup("SIGKILL");
    }
  }, 250);
}

process.on("SIGTERM", terminateChild);
process.on("SIGINT", terminateChild);

server.on("error", (error) => {
  writeLog(String(error?.message ? error.message : error));
  finish("failed", null);
});
try {
  fs.unlinkSync(config.socketPath);
} catch {}
server.listen(config.socketPath, () => {
  try {
    fs.chmodSync(config.socketPath, 0o600);
  } catch {}
});
