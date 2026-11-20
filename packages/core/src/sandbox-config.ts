import {
  constants,
  accessSync,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { updateJsonConfig } from "./config.js";
import { errorMessage } from "./format.js";
import { isRecord } from "./records.js";

export type SandboxBackend = "auto" | "bwrap" | "podman" | "docker";

export const SANDBOX_BACKENDS: readonly SandboxBackend[] = Object.freeze([
  "auto",
  "bwrap",
  "podman",
  "docker",
]);

export const DEFAULT_CONTAINER_IMAGE = "node:22-slim";

export interface SandboxOptions {
  cwd?: string;
  workspace?: string;
  offline?: boolean;
  network?: boolean;
  maskPaths?: string[];
  writablePaths?: readonly string[];
  filterExisting?: boolean;
  bwrapBinary?: string;
  backend?: SandboxBackend;
  image?: string;
  forceNested?: boolean;
}

export interface WrappedSandboxCommand {
  command: string;
  args: string[];
}

const DEFAULT_MASK_SEGMENTS: readonly (readonly string[])[] = [
  [".ssh"],
  [".gnupg"],
  [".aws"],
  [".kube"],
  [".docker"],
  [".config", "gh"],
  [".config", "gcloud"],
  [".azure"],
  [".git-credentials"],
  [".netrc"],
  [".npmrc"],
  [".pypirc"],
];

function defaultMaskPaths(): string[] {
  const home = homedir();
  return DEFAULT_MASK_SEGMENTS.map((segments) => join(home, ...segments));
}

export const DEFAULT_MASK_PATHS: readonly string[] = defaultMaskPaths();

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

export function isBwrapAvailable(binaryName = "bwrap"): boolean {
  return probeBwrapAvailability(binaryName).available;
}

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

export function buildSandboxArgs(options: SandboxOptions = {}): string[] {
  const resolvedTarget = resolve(
    options.workspace ?? options.cwd ?? process.cwd(),
  );
  const targetDir = tryRealpath(resolvedTarget) ?? resolvedTarget;
  const args: string[] = [
    "--die-with-parent",
    "--new-session",
    "--unshare-pid",
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

  for (const writablePath of options.writablePaths ?? []) {
    if (writablePath) {
      args.push("--bind", writablePath, writablePath);
    }
  }

  const candidateMasks = options.maskPaths ?? defaultMaskPaths();
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

export function isInsideSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PI_SANDBOX_ACTIVE === "1";
}

function probeBinaryOnPath(binaryName: string): BwrapProbeResult {
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

export function probeContainerBackend(
  binary: "podman" | "docker",
): BwrapProbeResult {
  return probeBinaryOnPath(binary);
}

export function resolveSandboxBackend(
  options: Pick<SandboxOptions, "backend" | "bwrapBinary"> = {},
): "bwrap" | "podman" | "docker" {
  const requested = options.backend ?? "bwrap";
  if (
    requested === "bwrap" ||
    requested === "podman" ||
    requested === "docker"
  ) {
    return requested;
  }
  if (probeBwrapAvailability(options.bwrapBinary ?? "bwrap").available) {
    return "bwrap";
  }
  if (probeContainerBackend("podman").available) {
    return "podman";
  }
  if (probeContainerBackend("docker").available) {
    return "docker";
  }
  return "bwrap";
}

export function buildContainerSandboxArgs(
  backend: "podman" | "docker",
  command: string,
  args: string[] = [],
  options: SandboxOptions = {},
): string[] {
  const resolvedTarget = resolve(
    options.workspace ?? options.cwd ?? process.cwd(),
  );
  const targetDir = tryRealpath(resolvedTarget) ?? resolvedTarget;
  const isOffline = options.offline ?? options.network === false;
  const image = options.image?.trim() || DEFAULT_CONTAINER_IMAGE;

  const containerArgs: string[] = [
    "run",
    "--rm",
    "-i",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
  ];
  if (backend === "podman") {
    containerArgs.push("--userns=keep-id");
  }
  if (isOffline) {
    containerArgs.push("--network=none");
  }
  containerArgs.push("-v", `${targetDir}:${targetDir}:rw`, "-w", targetDir);
  for (const writablePath of options.writablePaths ?? []) {
    if (writablePath) {
      const resolved =
        tryRealpath(resolve(writablePath)) ?? resolve(writablePath);
      if (resolved !== targetDir) {
        containerArgs.push("-v", `${resolved}:${resolved}:rw`);
      }
    }
  }
  containerArgs.push(
    "-e",
    "PI_SANDBOX_ACTIVE=1",
    "-e",
    `PI_SANDBOX_BACKEND=${backend}`,
  );
  if (isOffline) {
    containerArgs.push("-e", "PI_SANDBOX_OFFLINE=1");
  }
  containerArgs.push(image, command, ...args);
  return containerArgs;
}

export function wrapSandboxCommand(
  command: string,
  args: string[] = [],
  options: SandboxOptions = {},
): WrappedSandboxCommand {
  const isOffline = options.offline ?? options.network === false;
  if (
    !options.forceNested &&
    isInsideSandbox() &&
    (!isOffline || process.env.PI_SANDBOX_OFFLINE === "1")
  ) {
    return { command, args: [...args] };
  }

  const targetDir = options.workspace ?? options.cwd;
  const backend = resolveSandboxBackend(options);
  if (backend === "podman" || backend === "docker") {
    const probe = probeContainerBackend(backend);
    if (!probe.available) {
      throw new Error(
        `Container sandbox '${backend}' is required but was not found on PATH`,
      );
    }
  } else {
    const binary = options.bwrapBinary ?? "bwrap";
    assertBwrapAvailable(binary);
  }

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

  if (backend === "podman" || backend === "docker") {
    return {
      command: backend,
      args: buildContainerSandboxArgs(backend, command, args, options),
    };
  }

  const binary = options.bwrapBinary ?? "bwrap";
  const sandboxArgs = buildSandboxArgs(options);
  return {
    command: binary,
    args: [...sandboxArgs, "--", command, ...args],
  };
}

export interface SandboxConfig {
  readonly enabled: boolean;
  readonly offline?: boolean;
  readonly maskPaths?: readonly string[];
  readonly backend?: SandboxBackend;
  readonly image?: string;
}

export type SandboxDiagnosticFormatter = (
  label: string,
  field: string | undefined,
  expected: string,
) => string;

function quotedDiagnostic(
  label: string,
  field: string | undefined,
  expected: string,
): string {
  const path = field === undefined ? label : `${label}.${field}`;
  return `"${path}" must be ${expected}; ignoring`;
}

export function parseSandboxConfig(
  value: unknown,
  diagnostics: string[],
  label = "sandbox",
  formatDiagnostic: SandboxDiagnosticFormatter = quotedDiagnostic,
): boolean | SandboxConfig | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (!isRecord(value)) {
    diagnostics.push(formatDiagnostic(label, undefined, "a boolean or object"));
    return undefined;
  }

  let enabled: boolean | undefined;
  if (value.enabled !== undefined) {
    if (typeof value.enabled === "boolean") {
      enabled = value.enabled;
    } else {
      diagnostics.push(formatDiagnostic(label, "enabled", "a boolean"));
    }
  }

  let offline: boolean | undefined;
  if (value.offline !== undefined) {
    if (typeof value.offline === "boolean") {
      offline = value.offline;
    } else {
      diagnostics.push(formatDiagnostic(label, "offline", "a boolean"));
    }
  }

  let maskPaths: readonly string[] | undefined;
  if (value.maskPaths !== undefined) {
    if (
      Array.isArray(value.maskPaths) &&
      value.maskPaths.every(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim() !== "",
      )
    ) {
      maskPaths = Object.freeze([...value.maskPaths]);
    } else {
      diagnostics.push(
        formatDiagnostic(label, "maskPaths", "an array of non-empty strings"),
      );
    }
  }

  let backend: SandboxBackend | undefined;
  if (value.backend !== undefined) {
    if (
      typeof value.backend === "string" &&
      (SANDBOX_BACKENDS as readonly string[]).includes(value.backend)
    ) {
      backend = value.backend as SandboxBackend;
    } else {
      diagnostics.push(
        formatDiagnostic(
          label,
          "backend",
          `one of ${SANDBOX_BACKENDS.join(", ")}`,
        ),
      );
    }
  }

  let image: string | undefined;
  if (value.image !== undefined) {
    if (typeof value.image === "string" && value.image.trim() !== "") {
      image = value.image.trim();
    } else {
      diagnostics.push(formatDiagnostic(label, "image", "a non-empty string"));
    }
  }

  return Object.freeze({
    enabled:
      enabled !== undefined
        ? enabled
        : offline !== undefined ||
          maskPaths !== undefined ||
          backend !== undefined ||
          image !== undefined,
    ...(offline !== undefined ? { offline } : {}),
    ...(maskPaths !== undefined ? { maskPaths } : {}),
    ...(backend !== undefined ? { backend } : {}),
    ...(image !== undefined ? { image } : {}),
  });
}

export function resolveSandboxOptions(
  sandbox: boolean | SandboxConfig | undefined,
): boolean | SandboxOptions | undefined {
  if (sandbox === undefined || sandbox === false) return undefined;
  if (sandbox === true) return true;
  if (!sandbox.enabled) return undefined;
  return {
    ...(sandbox.offline !== undefined ? { offline: sandbox.offline } : {}),
    ...(sandbox.maskPaths !== undefined
      ? { maskPaths: [...sandbox.maskPaths] }
      : {}),
    ...(sandbox.backend !== undefined ? { backend: sandbox.backend } : {}),
    ...(sandbox.image !== undefined ? { image: sandbox.image } : {}),
  };
}

export function isSandboxEnabled(
  sandbox: boolean | SandboxConfig | undefined,
): boolean {
  if (sandbox === true) return true;
  return typeof sandbox === "object" && sandbox.enabled;
}

export function isSandboxOffline(
  sandbox: boolean | SandboxConfig | undefined,
): boolean {
  return typeof sandbox === "object" && sandbox.offline === true;
}

export interface SandboxSettings {
  sandboxEnabled: boolean;
  sandboxOffline?: boolean;
  maskPaths?: readonly string[];
}

export function saveSandboxConfig(
  filePath: string,
  settings: SandboxSettings,
): string {
  const res = updateJsonConfig(filePath, (root) => {
    const existing = isRecord(root.sandbox) ? { ...root.sandbox } : {};
    const next: Record<string, unknown> = {
      ...existing,
      enabled: settings.sandboxEnabled,
    };
    if (settings.sandboxOffline !== undefined) {
      next.offline = settings.sandboxOffline;
    }
    if (settings.maskPaths !== undefined) {
      next.maskPaths = [...settings.maskPaths];
    }
    root.sandbox = next;
  });
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.path;
}
