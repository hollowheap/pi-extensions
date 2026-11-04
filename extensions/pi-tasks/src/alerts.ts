import {
  type AlertDelivery,
  AlertDispatcher,
  buildAlertPayload,
} from "@hollowheap/core/alerts";

export interface TaskAlertState {
  id: string;
  status: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export class TaskAlertTracker {
  private readonly previous = new Map<string, string>();
  private readonly dispatcher = new AlertDispatcher();

  seed(task: TaskAlertState): void {
    this.previous.set(task.id, task.status);
  }

  async observe(
    tasks: readonly TaskAlertState[],
    delivery: AlertDelivery = {},
  ): Promise<void> {
    for (const task of tasks) {
      const before = this.previous.get(task.id);
      this.previous.set(task.id, task.status);
      if (before === undefined || before === task.status) continue;
      if (!TERMINAL.has(task.status)) continue;
      try {
        await this.dispatcher.dispatch(
          buildAlertPayload("task-completion", task.id, task.status),
          delivery,
        );
      } catch {
        // Alerts must never change task state.
      }
    }
  }
}

export const taskAlertTracker = new TaskAlertTracker();
