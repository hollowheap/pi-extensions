import { CompletionAlertTracker } from "@hollowheap/core/alerts";

export interface SubagentAlertState {
  id: string;
  status: string;
}

export class SubagentAlertTracker extends CompletionAlertTracker<SubagentAlertState> {
  constructor() {
    super({ topic: "subagent-completion" });
  }
}

export const subagentAlertTracker = new SubagentAlertTracker();
