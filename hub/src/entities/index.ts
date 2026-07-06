/**
 * Entity module re-exports.
 *
 * mission-84 W4: FS-version repositories (12 *-repository.ts files + counter.ts)
 * DELETED — substrate-version repos (W4.x.1-11 from mission-83) are sole canonical
 * production path; composed unconditionally in hub/src/index.ts substrate-mode
 * bootstrap (FS-mode dispatch fatal-exits post-W4). W2 already migrated hub/test/*
 * test-fixtures to substrate-version pattern via test-utils.ts.
 *
 * Entity-type files (idea.ts, mission.ts, etc.) preserved — they hold I*Store
 * interface definitions + entity type-shapes used by substrate-version repos.
 */

export type { Idea, IdeaStatus, IIdeaStore, CascadeBacklink as IdeaCascadeBacklink } from "./idea.js";
export { IdeaRepositorySubstrate } from "./idea-repository-substrate.js";

export { TaskRepositorySubstrate } from "./task-repository-substrate.js";
export { ProposalRepositorySubstrate } from "./proposal-repository-substrate.js";
export { ThreadRepositorySubstrate } from "./thread-repository-substrate.js";
export { AgentRepositorySubstrate } from "./agent-repository-substrate.js";
export { AuditRepositorySubstrate } from "./audit-repository-substrate.js";

export type {
  Mission,
  MissionStatus,
  IMissionStore,
  PlannedTask,
  PlannedTaskStatus,
  MissionClass,
  MissionPulses,
  PulseConfig,
  PulseKey,
  PulseResponseShape,
} from "./mission.js";
export {
  findNextUnissuedPlannedTask,
  MISSION_CLASSES,
  PULSE_KEYS,
  PULSE_RESPONSE_SHAPES,
  PULSE_INTERVAL_FLOOR_SECONDS,
  DEFAULT_MISSED_THRESHOLD,
  DEFAULT_ENGINEER_PULSE_INTERVAL_SECONDS,
  DEFAULT_ARCHITECT_PULSE_INTERVAL_SECONDS,
} from "./mission.js";
export { MissionRepositorySubstrate } from "./mission-repository-substrate.js";

export type { Turn, TurnStatus, ITurnStore } from "./turn.js";
export { TurnRepositorySubstrate } from "./turn-repository-substrate.js";

export { SubstrateCounter } from "./substrate-counter.js";

export type { Bug, BugStatus, BugSeverity, IBugStore, CascadeBacklink as BugCascadeBacklink } from "./bug.js";
export { BugRepositorySubstrate } from "./bug-repository-substrate.js";

export type {
  PendingActionItem,
  PendingActionState,
  PendingActionDispatchType,
  IPendingActionStore,
  EnqueueOptions,
} from "./pending-action.js";
export { DEFAULT_RECEIPT_SLA_MS, DEFAULT_COMPLETION_SLA_MS } from "./pending-action.js";
export { PendingActionRepositorySubstrate } from "./pending-action-repository-substrate.js";

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
export { MessageRepositorySubstrate } from "./message-repository-substrate.js";
