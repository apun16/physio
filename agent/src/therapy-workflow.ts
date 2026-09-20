import {
  AgentWorkflow,
  type AgentWorkflowEvent,
  type AgentWorkflowStep
} from "agents/workflows";
import type { TherapyGameAgent } from "./therapy-agent";
import { SessionSummarySchema, type SessionSummary } from "./therapy-schemas";

export class TherapySessionSummaryWorkflow extends AgentWorkflow<
  TherapyGameAgent,
  SessionSummary
> {
  async run(
    event: AgentWorkflowEvent<SessionSummary>,
    step: AgentWorkflowStep
  ) {
    const summary = SessionSummarySchema.parse(event.payload);
    const safeSummary = await step.do("validate-summary", async () => ({
      ...summary,
      completionRate:
        summary.attemptedReps > 0
          ? Math.round((summary.completedReps / summary.attemptedReps) * 100)
          : 0,
      note: "Performance summary only. No diagnosis or treatment change."
    }));
    await step.reportComplete(safeSummary);
    return safeSummary;
  }
}
