import { CompletionAlertTracker } from "@hollowheap/core/alerts";

export interface TaskAlertState {
  id: string;
  status: string;
}

export class TaskAlertTracker extends CompletionAlertTracker<TaskAlertState> {
  constructor() {
    super({ topic: "task-completion" });
  }
}

export const taskAlertTracker = new TaskAlertTracker();
