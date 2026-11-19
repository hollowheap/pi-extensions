import {
  constants,
  accessSync,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { errorMessage } from "./utils.js";

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
  join(homedir(), ".aws"),
  join(homedir(), ".kube"),
  join(homedir(), ".docker"),
  join(homedir(), ".config", "gh"),
  join(homedir(), ".config", "gcloud"),
  join(homedir(), ".azure"),
  join(homedir(), ".git-credentials"),
  join(homedir(), ".netrc"),
  join(homedir(), ".npmrc"),
  join(homedir(), ".pypirc"),
];

function tryRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}

function appendMaskArgs(
  args: string[],
  maskPath: string,
  targetDir: string,
  shouldFilter: boolean,
): void {
  const linkStat = lstatSync(maskPath, { throwIfNoEntry: false });
  if (shouldFilter && linkStat === undefined) return;
  let targetStat = linkStat;
  if (linkStat?.isSymbolicLink()) {
    try {
      targetStat = statSync(maskPath);
    } catch {
      targetStat = undefined;
    }
  }
  const addMount = (mountPath: string, isFile: boolean) => {
    if (isFile) {
      args.push("--ro-bind", "/dev/null", mountPath);
    } else {
      args.push("--tmpfs", mountPath);
    }
  };
  if (linkStat?.isSymbolicLink()) {
    const resolvedMask = tryRealpath(maskPath);
    if (
      resolvedMask !== undefined &&
      resolvedMask !== maskPath &&
      !isInsideOrEqual(targetDir, resolvedMask)
    ) {
      addMount(resolvedMask, targetStat?.isFile() ?? false);
    }
    return;
  }
  addMount(maskPath, targetStat?.isFile() ?? false);
}

export function isOsPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return true;
  }
  const message = errorMessage(error);
  return /\b(EACCES|EPERM|EROFS|permission denied|operation not permitted)\b/i.test(
    message,
  );
}

export type BwrapProbeResult =
  | { available: true; path: string }
  | {
      available: false;
      reason: "unsupported" | "missing" | "permission";
      path?: string;
      error?: unknown;
    };

/**
 * Probes Bubblewrap binary availability, distinguishing missing binaries from
 * OS permission errors (`EACCES` / `EPERM`).
 */
export function probeBwrapAvailability(binaryName = "bwrap"): BwrapProbeResult {
  if (process.platform !== "linux") {
    return { available: false, reason: "unsupported" };
  }
  if (isAbsolute(binaryName)) {
    try {
      const stat = statSync(binaryName);
      if (stat.isFile()) {
        accessSync(binaryName, constants.X_OK);
        return { available: true, path: binaryName };
      }
      return { available: false, reason: "missing", path: binaryName };
    } catch (error) {
      if (isOsPermissionError(error)) {
        return {
          available: false,
          reason: "permission",
          path: binaryName,
          error,
        };
      }
      return { available: false, reason: "missing", path: binaryName, error };
    }
  }
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(delimiter);
  let permissionIssue: { path: string; error: unknown } | undefined;
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = join(dir, binaryName);
    try {
      const stat = statSync(candidate);
      if (stat.isFile()) {
        accessSync(candidate, constants.X_OK);
        return { available: true, path: candidate };
      }
    } catch (error) {
      if (isOsPermissionError(error) && !permissionIssue) {
        permissionIssue = { path: candidate, error };
      }
    }
  }
  if (permissionIssue) {
    return {
      available: false,
      reason: "permission",
      path: permissionIssue.path,
      error: permissionIssue.error,
    };
  }
  return { available: false, reason: "missing" };
}

/**
 * Checks whether the Bubblewrap binary (`bwrap` or specified binary) is available
 * and executable on the system. Bubblewrap requires Linux user namespaces.
 */
export function isBwrapAvailable(binaryName = "bwrap"): boolean {
  return probeBwrapAvailability(binaryName).available;
}

/**
 * Asserts that the Bubblewrap binary is available, throwing an error if missing
 * or inaccessible due to OS permissions.
 */
export function assertBwrapAvailable(binaryName = "bwrap"): void {
  const probe = probeBwrapAvailability(binaryName);
  if (probe.available) return;
  if (probe.reason === "permission") {
    const code = (probe.error as NodeJS.ErrnoException | undefined)?.code;
    const detail = probe.error !== undefined ? errorMessage(probe.error) : "";
    throw new Error(
      `Bubblewrap sandbox is required, but '${probe.path ?? binaryName}' cannot be accessed (${code ?? "OS permission"} denied — check chmod +x and directory permissions): ${detail}`,
    );
  }
  if (probe.reason === "unsupported") {
    throw new Error(
      "Bubblewrap sandbox is required, but Linux namespaces are required on this host",
    );
  }
  throw new Error(
    `Bubblewrap sandbox is required but '${binaryName}' was not found on PATH`,
  );
}

/**
 * Builds the array of command-line arguments for `bwrap`.
 */
export function buildSandboxArgs(options: SandboxOptions = {}): string[] {
  const resolvedTarget = resolve(
    options.workspace ?? options.cwd ?? process.cwd(),
  );
  const targetDir = tryRealpath(resolvedTarget) ?? resolvedTarget;
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
    appendMaskArgs(args, maskPath, targetDir, shouldFilter);
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
    } catch (error) {
      if (isOsPermissionError(error)) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        const detail = errorMessage(error);
        throw new Error(
          `${command} failed: OS permission denied accessing working directory ${targetDir} (${code ?? "permission"}): ${detail}`,
        );
      }
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
