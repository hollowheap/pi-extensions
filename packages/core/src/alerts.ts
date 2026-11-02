import { runCapture } from "./exec.js";

export const ALERT_EVENTS = [
  "completion",
  "error",
  "question",
  "task-completion",
  "subagent-completion",
] as const;

export type AlertEvent = (typeof ALERT_EVENTS)[number];

export interface AlertPayload {
  event: AlertEvent;
  id?: string;
  status?: string;
}

export type AlertDeliveryMode = "native" | "fallback" | "duplicate";

export interface AlertDelivery {
  platform?: NodeJS.Platform;
  notify?: (payload: AlertPayload) => boolean | Promise<boolean>;
  fallback?: (payload: AlertPayload) => void;
}

function assertEvent(event: string): asserts event is AlertEvent {
  if (!ALERT_EVENTS.includes(event as AlertEvent)) {
    throw new Error(`unknown alert event: ${event}`);
  }
}

export function buildAlertPayload(
  event: AlertEvent,
  id?: string,
  status?: string,
): AlertPayload {
  assertEvent(event);
  return {
    event,
    ...(id === undefined ? {} : { id }),
    ...(status === undefined ? {} : { status }),
  };
}

function alertText(payload: AlertPayload): string {
  return [payload.event, payload.id, payload.status].filter(Boolean).join(" ");
}

async function notifyLinux(payload: AlertPayload): Promise<boolean> {
  try {
    const result = await runCapture(
      "notify-send",
      ["pi", alertText(payload)],
      process.cwd(),
      undefined,
      { timeoutMs: 5_000 },
    );
    return result.code === 0;
  } catch {
    return false;
  }
}

export async function deliverAlert(
  payload: AlertPayload,
  delivery: AlertDelivery = {},
): Promise<AlertDeliveryMode> {
  const platform = delivery.platform ?? process.platform;
  if (platform === "linux") {
    const delivered = delivery.notify
      ? await delivery.notify(payload)
      : await notifyLinux(payload);
    if (delivered) return "native";
  }
  if (delivery.fallback) {
    delivery.fallback(payload);
  } else {
    process.stdout.write("\u0007");
  }
  return "fallback";
}

export class AlertDispatcher {
  private readonly seen = new Set<string>();

  async dispatch(
    payload: AlertPayload,
    delivery: AlertDelivery = {},
  ): Promise<AlertDeliveryMode> {
    const key = `${payload.event}\0${payload.id ?? ""}`;
    if (this.seen.has(key)) return "duplicate";
    this.seen.add(key);
    return deliverAlert(payload, delivery);
  }

  clear(): void {
    this.seen.clear();
  }
}
