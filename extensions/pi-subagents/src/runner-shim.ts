export const RUNNER_SHIM = String.raw`
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const { dirname, join } = require("node:path");

const configPath = process.argv[1];
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
let exited = false;
let aborting = false;

function readStartTime(pid) {
  try {
    const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return undefined;
    const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
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

function update(patch) {
  const next = Object.assign({}, readState(), patch);
  const tmp = join(dirname(config.statePath), "." + config.id + "." + process.pid + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch {}
  fs.renameSync(tmp, config.statePath);
}

const log = fs.createWriteStream(config.logPath, { flags: "a", mode: 0o600 });
try { fs.chmodSync(config.logPath, 0o600); } catch {}

const child = spawn(config.command, config.args || [], {
  cwd: config.cwd,
  env: Object.assign({}, process.env, config.env || {}),
  stdio: ["pipe", "pipe", "pipe"],
});
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });

update({
  status: "running",
  pid: child.pid,
  startTime: child.pid === undefined ? undefined : readStartTime(child.pid),
});

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
      const id = request && request.id;
      const action = request && request.action;
      if (action === "send") {
        if (!child.stdin.writable || exited) {
          socket.write(JSON.stringify({ id, ok: false, error: "child is not accepting input" }) + "\n");
          continue;
        }
        const payload = request.payload;
        child.stdin.write((typeof payload === "string" ? payload : JSON.stringify(payload)) + "\n");
        socket.write(JSON.stringify({ id, ok: true }) + "\n");
        continue;
      }
      if (action === "abort") {
        aborting = true;
        try { child.kill("SIGTERM"); } catch {}
        setTimeout(() => {
          if (!exited) {
            try { child.kill("SIGKILL"); } catch {}
          }
        }, 250);
        socket.write(JSON.stringify({ id, ok: true }) + "\n");
        continue;
      }
      if (action === "status") {
        socket.write(JSON.stringify({
          id,
          ok: true,
          payload: { pid: child.pid, alive: !exited, status: aborting ? "cancelled" : "running" },
        }) + "\n");
        continue;
      }
      socket.write(JSON.stringify({ id, ok: false, error: "unknown action" }) + "\n");
    }
  });
});

function closeServer() {
  for (const socket of sockets) socket.destroy();
  try { server.close(() => {}); } catch {}
  try { fs.unlinkSync(config.socketPath); } catch {}
}

function finish(status, code) {
  if (exited) return;
  exited = true;
  update({
    status,
    exitCode: typeof code === "number" ? code : null,
    finishedAt: Date.now(),
  });
  log.end();
  closeServer();
  setTimeout(() => process.exit(0), 50);
}

child.on("error", (error) => {
  try { log.write(String(error && error.message ? error.message : error) + "\n"); } catch {}
  finish("failed", null);
});
child.on("exit", (code) => {
  finish(aborting ? "cancelled" : code === 0 ? "completed" : "failed", code);
});
process.on("SIGTERM", () => {
  aborting = true;
  try { child.kill("SIGTERM"); } catch {}
});
process.on("SIGINT", () => {
  aborting = true;
  try { child.kill("SIGTERM"); } catch {}
});

server.on("error", (error) => {
  try { log.write(String(error && error.message ? error.message : error) + "\n"); } catch {}
  finish("failed", null);
});
try { fs.unlinkSync(config.socketPath); } catch {}
server.listen(config.socketPath, () => {
  try { fs.chmodSync(config.socketPath, 0o600); } catch {}
});
`;
