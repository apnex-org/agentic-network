/**
 * Entity module re-exports.
 */

export type { Idea, IdeaStatus, IIdeaStore, CascadeBacklink as IdeaCascadeBacklink } from "./idea.js";
export { IdeaRepository } from "./idea-repository.js";

export { TaskRepository } from "./task-repository.js";
export { ProposalRepository } from "./proposal-repository.js";
export { ThreadRepository } from "./thread-repository.js";
export { AgentRepository } from "./agent-repository.js";
export { AuditRepository } from "./audit-repository.js";

export type { Mission, MissionStatus, IMissionStore, PlannedTask, PlannedTaskStatus } from "./mission.js";
export { findNextUnissuedPlannedTask } from "./mission.js";
export { MissionRepository } from "./mission-repository.js";

export type { Turn, TurnStatus, ITurnStore } from "./turn.js";
export { TurnRepository } from "./turn-repository.js";

export type { Tele, TeleStatus, ITeleStore } from "./tele.js";
export { normalizeTele } from "./tele.js";
export { TeleRepository } from "./tele-repository.js";
export { StorageBackedCounter } from "./counter.js";
export type { Counters, CounterField } from "./counter.js";

export type { Bug, BugStatus, BugSeverity, IBugStore, CascadeBacklink as BugCascadeBacklink } from "./bug.js";
export { BugRepository } from "./bug-repository.js";

export type {
  PendingActionItem,
  PendingActionState,
  PendingActionDispatchType,
  IPendingActionStore,
  EnqueueOptions,
} from "./pending-action.js";
export { DEFAULT_RECEIPT_SLA_MS, DEFAULT_COMPLETION_SLA_MS } from "./pending-action.js";
export { PendingActionRepository } from "./pending-action-repository.js";

// Mission-51 W1: Message sovereign primitive
// Mission-51 W4: scheduledState lifecycle + retry interlock fields
export type {
  Message,
  MessageKind,
  MessageAuthorRole,
  MessageDelivery,
  MessageStatus,
  MessageScheduledState,
  MessageTarget,
  KindAxes,
  IMessageStore,
  CreateMessageInput,
  MessageQuery,
} from "./message.js";
export {
  MESSAGE_KINDS,
  MESSAGE_AUTHOR_ROLES,
  MESSAGE_DELIVERY_MODES,
  MESSAGE_STATUSES,
  MESSAGE_SCHEDULED_STATES,
  KIND_AXES,
  MessageSchema,
  checkAuthorAuthorized,
  requiresTurn,
  shiftsTurn,
  messagePath,
  threadIndexPath,
  makeMigrationSourceId,
} from "./message.js";
export { MessageRepository } from "./message-repository.js";
