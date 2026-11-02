import {
  type AlertDelivery,
  buildAlertPayload,
  deliverAlert,
} from "@hollowheap/core";

function defaultDelivery(): AlertDelivery {
  if (process.env.VITEST !== undefined) {
    return { platform: "linux", notify: () => false, fallback: () => {} };
  }
  return {};
}

export async function deliverAgentCompletionAlert(
  delivery: AlertDelivery,
): Promise<void> {
  try {
    await deliverAlert(
      buildAlertPayload("completion", undefined, "settled"),
      delivery,
    );
  } catch {
    // Alerts must never affect the footer.
  }
}

export function alertAgentCompletion(): void {
  void deliverAgentCompletionAlert(defaultDelivery());
}
