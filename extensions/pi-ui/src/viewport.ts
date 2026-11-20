import { Key, matchesKey } from "@earendil-works/pi-tui";

export interface ViewportKeyHandlers {
  onClose: () => void;
  onScrollBy: (delta: number) => void;
  onScrollTo: (offset: number) => void;
  pageSize: () => number;
  maxOffset: () => number;
  closeOnEnter?: boolean;
  pagerKeys?: boolean;
}

export function handleViewportKey(
  data: string,
  handlers: ViewportKeyHandlers,
): boolean {
  if (
    matchesKey(data, Key.escape) ||
    matchesKey(data, Key.ctrl("c")) ||
    data === "q" ||
    (handlers.closeOnEnter && matchesKey(data, Key.enter))
  ) {
    handlers.onClose();
    return true;
  }
  if (matchesKey(data, Key.up) || data === "k") {
    handlers.onScrollBy(-1);
    return true;
  }
  if (matchesKey(data, Key.down) || data === "j") {
    handlers.onScrollBy(1);
    return true;
  }
  if (matchesKey(data, Key.pageUp) || (handlers.pagerKeys && data === "b")) {
    handlers.onScrollBy(-handlers.pageSize());
    return true;
  }
  if (
    matchesKey(data, Key.pageDown) ||
    (handlers.pagerKeys && (matchesKey(data, Key.space) || data === "f"))
  ) {
    handlers.onScrollBy(handlers.pageSize());
    return true;
  }
  if (matchesKey(data, Key.home) || data === "g") {
    handlers.onScrollTo(0);
    return true;
  }
  if (matchesKey(data, Key.end) || data === "G") {
    handlers.onScrollTo(handlers.maxOffset());
    return true;
  }
  return false;
}
