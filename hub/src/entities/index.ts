/**
 * Entity module re-exports.
 *
 * mission-83 W6: FS-version repositories (Agent/Audit/Bug/Idea/Message/Mission/
 * PendingAction/Proposal/Task/Tele/Thread/Turn + counter.ts) PRESERVED as
 * test-only fixtures (hub/test/* tests via test-utils.ts use Memory+FS-repo
 * pattern; mass-migration to substrate-version + testcontainers postgres is
 * separate scope-rescope discussion with architect). Substrate-versioned
 * repositories from W4.x.1-11 are the sole production path; composed in
 * hub/src/index.ts substrate-mode bootstrap.
 *
 * Entity-type files (idea.ts, mission.ts, etc.) preserved — they hold I*Store
 * interface definitions + entity type-shapes used by BOTH substrate-version
 * AND FS-version repos.
 */

export type { Idea, IdeaStatus, IIdeaStore, CascadeBacklink as IdeaCascadeBacklink } from "./idea.js";
export { IdeaRepository } from "./idea-repository.js";
export { IdeaRepositorySubstrate } from "./idea-repository-substrate.js";

export { TaskRepository } from "./task-repository.js";
export { TaskRepositorySubstrate } from "./task-repository-substrate.js";
export { ProposalRepository } from "./proposal-repository.js";
export { ProposalRepositorySubstrate } from "./proposal-repository-substrate.js";
export { ThreadRepository } from "./thread-repository.js";
export { ThreadRepositorySubstrate } from "./thread-repository-substrate.js";
export { AgentRepository } from "./agent-repository.js";
export { AgentRepositorySubstrate } from "./agent-repository-substrate.js";
export { AuditRepository } from "./audit-repository.js";
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
export { MissionRepository } from "./mission-repository.js";
export { MissionRepositorySubstrate } from "./mission-repository-substrate.js";

export type { Turn, TurnStatus, ITurnStore } from "./turn.js";
export { TurnRepository } from "./turn-repository.js";
export { TurnRepositorySubstrate } from "./turn-repository-substrate.js";

export type { Tele, TeleStatus, ITeleStore } from "./tele.js";
export { normalizeTele } from "./tele.js";
export { TeleRepository } from "./tele-repository.js";
export { TeleRepositorySubstrate } from "./tele-repository-substrate.js";
export { StorageBackedCounter } from "./counter.js";  // test-only fixture (W6 carve-out)
export type { Counters, CounterField } from "./counter.js";
export { SubstrateCounter } from "./substrate-counter.js";

export type { Bug, BugStatus, BugSeverity, IBugStore, CascadeBacklink as BugCascadeBacklink } from "./bug.js";
export { BugRepository } from "./bug-repository.js";
export { BugRepositorySubstrate } from "./bug-repository-substrate.js";

export type {
  PendingActionItem,
  PendingActionState,
  PendingActionDispatchType,
  IPendingActionStore,
  EnqueueOptions,
} from "./pending-action.js";
export { DEFAULT_RECEIPT_SLA_MS, DEFAULT_COMPLETION_SLA_MS } from "./pending-action.js";
export { PendingActionRepository } from "./pending-action-repository.js";
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
export { MessageRepository } from "./message-repository.js";
export { MessageRepositorySubstrate } from "./message-repository-substrate.js";
