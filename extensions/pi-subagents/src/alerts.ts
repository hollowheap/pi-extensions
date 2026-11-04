import {
  type AlertDelivery,
  AlertDispatcher,
  buildAlertPayload,
} from "@hollowheap/core/alerts";

export interface SubagentAlertState {
  id: string;
  status: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export class SubagentAlertTracker {
  private readonly previous = new Map<string, string>();
  private readonly dispatcher = new AlertDispatcher();

  seed(state: SubagentAlertState): void {
    this.previous.set(state.id, state.status);
  }

  async observe(
    states: readonly SubagentAlertState[],
    delivery: AlertDelivery = {},
  ): Promise<void> {
    for (const state of states) {
      const before = this.previous.get(state.id);
      this.previous.set(state.id, state.status);
      if (before === undefined || before === state.status) continue;
      if (!TERMINAL.has(state.status)) continue;
      try {
        await this.dispatcher.dispatch(
          buildAlertPayload("subagent-completion", state.id, state.status),
          delivery,
        );
      } catch {
        // Alerts must never change subagent state.
      }
    }
  }
}

export const subagentAlertTracker = new SubagentAlertTracker();
