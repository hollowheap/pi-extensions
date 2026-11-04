import {
  type AlertDelivery,
  buildAlertPayload,
  deliverAlert,
} from "@hollowheap/core/alerts";

function defaultDelivery(): AlertDelivery {
  if (process.env.VITEST !== undefined) {
    return { platform: "linux", notify: () => false, fallback: () => {} };
  }
  return {};
}

export async function deliverQuestionAlert(
  delivery: AlertDelivery,
): Promise<void> {
  try {
    await deliverAlert(
      buildAlertPayload("question", undefined, "asked"),
      delivery,
    );
  } catch {
    // Alerts must never block the question dialog.
  }
}

export function alertQuestion(): void {
  void deliverQuestionAlert(defaultDelivery());
}
