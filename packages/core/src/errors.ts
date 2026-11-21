import { errorMessage } from "@hollowheap/runtime/primitives";

export function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return true;
  }
  return /\b(EACCES|EPERM|EROFS|permission denied|operation not permitted|read-only file system)\b/i.test(
    errorMessage(error),
  );
}
