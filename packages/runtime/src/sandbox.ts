import { constants, accessSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";

export interface SandboxOptions {
  cwd?: string;
  workspace?: string;
  offline?: boolean;
  network?: boolean;
  maskPaths?: string[];
  filterExisting?: boolean;
  bwrapBinary?: string;
}

export interface WrappedSandboxCommand {
  command: string;
  args: string[];
}

export const DEFAULT_MASK_PATHS: readonly string[] = [
  join(homedir(), ".ssh"),
  join(homedir(), ".gnupg"),
];

/**
 * Checks whether the Bubblewrap binary (`bwrap` or specified binary) is available
 * and executable on the system. Bubblewrap requires Linux user namespaces.
 */
export function isBwrapAvailable(binaryName = "bwrap"): boolean {
  if (process.platform !== "linux") return false;
  if (isAbsolute(binaryName)) {
    try {
      accessSync(binaryName, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = join(dir, binaryName);
    try {
      const stat = statSync(candidate);
      if (stat.isFile()) {
        accessSync(candidate, constants.X_OK);
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * Asserts that the Bubblewrap binary is available, throwing an error if missing.
 */
export function assertBwrapAvailable(binaryName = "bwrap"): void {
  if (!isBwrapAvailable(binaryName)) {
    throw new Error(
      `Bubblewrap sandbox is required but '${binaryName}' was not found on PATH`,
    );
  }
}

/**
 * Builds the array of command-line arguments for `bwrap`.
 */
export function buildSandboxArgs(options: SandboxOptions = {}): string[] {
  const targetDir = resolve(options.workspace ?? options.cwd ?? process.cwd());
  const args: string[] = [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    targetDir,
    targetDir,
  ];

  const candidateMasks = options.maskPaths ?? [...DEFAULT_MASK_PATHS];
  const shouldFilter =
    options.filterExisting ?? options.maskPaths === undefined;

  for (const maskPath of candidateMasks) {
    if (!shouldFilter || existsSync(maskPath)) {
      args.push("--tmpfs", maskPath);
    }
  }

  const isOffline = options.offline ?? options.network === false;
  if (isOffline) {
    args.push("--unshare-net");
  }

  return args;
}

/**
 * Wraps a target command and arguments in a Bubblewrap sandbox invocation.
 * Fails closed by throwing if Bubblewrap is missing or the working directory does not exist.
 */
export function wrapSandboxCommand(
  command: string,
  args: string[] = [],
  options: SandboxOptions = {},
): WrappedSandboxCommand {
  const binary = options.bwrapBinary ?? "bwrap";
  assertBwrapAvailable(binary);

  const targetDir = options.workspace ?? options.cwd;
  if (targetDir) {
    try {
      statSync(targetDir);
    } catch {
      throw new Error(
        `${command} failed: working directory does not exist: ${targetDir}`,
      );
    }
  }

  const sandboxArgs = buildSandboxArgs(options);
  return {
    command: binary,
    args: [...sandboxArgs, "--", command, ...args],
  };
}
