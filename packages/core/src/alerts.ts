import { runCapture } from "@hollowheap/runtime/exec";

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

type NotificationCommand = [command: string, args: string[], timeoutMs: number];

const MACOS_NOTIFICATION = `on run argv
  display notification (item 1 of argv) with title "pi"
end run`;

function windowsNotification(message: string): NotificationCommand {
  const encodedMessage = Buffer.from(message, "utf8").toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
if (-not [Environment]::UserInteractive) { exit 1 }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$message = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedMessage}'))
$icon = New-Object System.Windows.Forms.NotifyIcon
try {
  $icon.Icon = [System.Drawing.SystemIcons]::Information
  $icon.Visible = $true
  $icon.ShowBalloonTip(5000, 'pi', $message, [System.Windows.Forms.ToolTipIcon]::Info)
  Start-Sleep -Seconds 5
} finally {
  $icon.Dispose()
}`;
  return [
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    10_000,
  ];
}

const notificationCommands: Partial<
  Record<NodeJS.Platform, (message: string) => NotificationCommand>
> = {
  linux: (message) => ["notify-send", ["pi", message], 5_000],
  darwin: (message) => [
    "osascript",
    ["-e", MACOS_NOTIFICATION, message],
    5_000,
  ],
  win32: windowsNotification,
};

export async function deliverAlert(
  payload: AlertPayload,
  delivery: AlertDelivery = {},
): Promise<AlertDeliveryMode> {
  const notification =
    notificationCommands[delivery.platform ?? process.platform];
  if (notification) {
    try {
      if (delivery.notify) {
        if (await delivery.notify(payload)) return "native";
      } else {
        const [command, args, timeoutMs] = notification(alertText(payload));
        const result = await runCapture(
          command,
          args,
          process.cwd(),
          undefined,
          {
            timeoutMs,
          },
        );
        if (result.code === 0) return "native";
      }
    } catch {
      // A missing or failed notifier falls through to terminal delivery.
    }
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

const DEFAULT_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export interface CompletionAlertTrackerOptions {
  topic: AlertEvent;
  terminalStatuses?: Iterable<string>;
}

export class CompletionAlertTracker<
  T extends { id: string; status: string } = { id: string; status: string },
> {
  private readonly topic: AlertEvent;
  private readonly terminalStatuses: ReadonlySet<string>;
  private readonly previous = new Map<string, string>();
  private readonly dispatcher = new AlertDispatcher();

  constructor(options: CompletionAlertTrackerOptions) {
    assertEvent(options.topic);
    this.topic = options.topic;
    this.terminalStatuses =
      options.terminalStatuses === undefined
        ? DEFAULT_TERMINAL_STATUSES
        : options.terminalStatuses instanceof Set
          ? options.terminalStatuses
          : new Set(options.terminalStatuses);
  }

  seed(item: T): void {
    this.previous.set(item.id, item.status);
  }

  async observe(
    items: readonly T[],
    delivery: AlertDelivery = {},
  ): Promise<void> {
    for (const item of items) {
      const before = this.previous.get(item.id);
      this.previous.set(item.id, item.status);
      if (before === undefined || before === item.status) continue;
      if (!this.terminalStatuses.has(item.status)) continue;
      try {
        await this.dispatcher.dispatch(
          buildAlertPayload(this.topic, item.id, item.status),
          delivery,
        );
      } catch {
        // Alerts must never change caller state.
      }
    }
  }
}
