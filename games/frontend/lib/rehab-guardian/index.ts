export type { GuardianEvent, GuardianState, SanitizedIncident } from "./types";
export { reduce, isSidekickVisible, createGuardian } from "./machine";
export { watchSensor } from "./watch";
export { reportFailure, reportRecovery, reportSpan, reportSidekickFailure, breadcrumbTransition } from "./reporter";
export { runRecovery } from "./recovery";
export { sanitizeIncident, receiptLines } from "./privacy";
