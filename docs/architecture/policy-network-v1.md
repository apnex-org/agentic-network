# Agentic Policy Network (Layer 7) - v1

## 1. Overview

This document defines the Application/Workflow Layer (Layer 7) of the OIS Platform. It governs the state machines, routing rules, and teleological alignment of all first-class cognitive entities, sitting above the physical Agentic Network (Layer 4).

**Module structure:**
```
hub/src/entities/
├── idea.ts       — IIdeaStore interface + MemoryIdeaStore
├── mission.ts    — IMissionStore interface + MemoryMissionStore
├── turn.ts       — ITurnStore interface + MemoryTurnStore
├── tele.ts       — ITeleStore interface + MemoryTeleStore
└── index.ts      — Re-exports all types and implementations
```

Each entity owns its types, interface, and Memory implementation in a sovereign module. GCS implementations follow the same pattern when persistence is required.

---

## 2. Core Cognitive Entities

### 2.1 Idea

**Purpose:** The raw, unrefined backlog (The "What if?").

**Schema:**
```typescript
type IdeaStatus = "open" | "triaged" | "dismissed" | "incorporated";

interface Idea {
  id: string;              // "idea-1", "idea-2", etc.
  text: string;            // The idea content
  author: string;          // Role of creator ("director" | "architect" | "engineer")
  status: IdeaStatus;
  missionId: string | null;      // Linked mission if incorporated
  sourceThreadId: string | null; // Thread where idea originated
  tags: string[];                // Optional categorization
  createdAt: string;       // ISO 8601
  updatedAt: string;
}
```

**MCP Tools:**

| Tool           | Role      | Parameters                              | Description                     |
| -------------- | --------- | --------------------------------------- | ------------------------------- |
| `submit_idea`  | Any       | `text`, `sourceThreadId?`, `tags?`      | Create a new idea               |
| `list_ideas`   | Any       | `status?`                               | List ideas, optionally filtered |
| `update_idea`  | Architect | `ideaId`, `status?`, `missionId?`, `tags?` | Update status, link to mission  |

### 2.2 Mission

**Purpose:** The overarching feature epic or strategic arc (The "What").

**Schema:**
```typescript
type MissionStatus = "proposed" | "active" | "completed" | "abandoned";

interface Mission {
  id: string;              // "mission-1", etc.
  title: string;
  description: string;     // Brief summary
  documentRef: string | null; // GCS document path for full brief
  status: MissionStatus;
  tasks: string[];         // Linked task IDs (auto-populated)
  ideas: string[];         // Linked idea IDs (auto-populated)
  correlationId: string | null; // Self-referencing (= id) for auto-linkage
  createdAt: string;
  updatedAt: string;
}
```

**MCP Tools:**

| Tool             | Role      | Parameters                                        | Description                      |
| ---------------- | --------- | ------------------------------------------------- | -------------------------------- |
| `create_mission` | Architect | `title`, `description`, `documentRef?`            | Create a new mission             |
| `update_mission` | Architect | `missionId`, `status?`, `description?`, `documentRef?` | Update status or description |
| `get_mission`    | Any       | `missionId`                                       | Read mission with linked entities |
| `list_missions`  | Any       | `status?`                                         | List missions, optionally filtered |

**Linkage (Virtual View):**
- `mission.tasks` is computed on every read as the set of Task IDs where `task.correlationId === mission.id`.
- `mission.ideas` is computed on every read as the set of Idea IDs where `idea.missionId === mission.id`.
- No explicit link step — setting `correlationId` on a Task (via `submit_directive` / scaffold) or `missionId` on an Idea (via `update_idea`) is sufficient.
- Prior iterations stored these as arrays on the Mission and appended via `linkTask` / `linkIdea`; that pattern lost writes under concurrent auto-linkage (task-223) and has been retired.

### 2.3 Turn

**Purpose:** The active execution cycle (The "When"). A Turn groups specific Missions and Tasks, guided by Tele goals.

**Schema:**
```typescript
type TurnStatus = "planning" | "active" | "completed";

interface Turn {
  id: string;              // "turn-1", etc.
  title: string;
  scope: string;           // Free-text markdown description of objectives
  status: TurnStatus;
  missionIds: string[];    // Linked mission IDs
  taskIds: string[];       // Linked task IDs
  tele: string[];          // Tele IDs — teleological goals for this turn
  correlationId: string | null; // Self-referencing for linkage
  createdAt: string;
  updatedAt: string;
}
```

**MCP Tools:**

| Tool          | Role      | Parameters                             | Description                     |
| ------------- | --------- | -------------------------------------- | ------------------------------- |
| `create_turn` | Architect | `title`, `scope`, `tele?`              | Create a new turn               |
| `update_turn` | Architect | `turnId`, `status?`, `scope?`, `tele?` | Update status, scope, or tele   |
| `get_turn`    | Any       | `turnId`                               | Read turn with all linked entities |
| `list_turns`  | Any       | `status?`                              | List turns, optionally filtered |

### 2.4 Tele

**Purpose:** A "declaration of perfection" or qualitative asymptote that the system strives toward. Static registry entry — immutable after creation.

**Schema:**
```typescript
interface Tele {
  id: string;              // "tele-1", etc.
  name: string;            // Short name (e.g., "Absolute State Fidelity")
  description: string;     // What this tele represents
  successCriteria: string; // Markdown describing the measurable target
  createdAt: string;
}
```

**MCP Tools:**

| Tool          | Role      | Parameters                                    | Description               |
| ------------- | --------- | --------------------------------------------- | ------------------------- |
| `define_tele` | Architect | `name`, `description`, `successCriteria`      | Define a new tele         |
| `get_tele`    | Any       | `teleId`                                      | Read a tele definition    |
| `list_tele`   | Any       | (none)                                        | List all defined tele     |

---

## 3. State Machines & Transitions

### Idea Lifecycle

```
open → triaged → incorporated (linked to Mission)
     → dismissed
```

- `open`: Initial state on `submit_idea`
- `triaged`: Architect has reviewed and categorized
- `incorporated`: Linked to a Mission via `update_idea` with `missionId` — triggers auto-linkage to Mission's `ideas[]` array
- `dismissed`: Not pursued

No approval gate — the Architect transitions directly via `update_idea`.

### Mission Lifecycle

```
proposed → active → completed
                  → abandoned
```

- `proposed`: Initial state on `create_mission`
- `active`: Work has begun — emits `mission_activated` notification
- `completed`: All work done
- `abandoned`: Cancelled

Tasks are auto-linked when `submit_directive` is called with `correlationId` matching the mission ID.

### Turn Lifecycle

```
planning → active → completed
```

- `planning`: Initial state on `create_turn`. Scope and Tele goals defined.
- `active`: Execution in progress — emits `turn_updated` notification
- `completed`: Turn cycle finished — emits `turn_updated` notification

Turns reference Missions and Tasks by ID arrays. These are populated manually via `update_turn` or future auto-linkage.

### Tele Lifecycle

```
(none) — static once created
```

Tele entries are immutable registry items. No status transitions. Active from the moment of creation via `define_tele`.

---

## 4. Teleological Alignment

### How Turns Reference Tele

Each Turn has a `tele: string[]` field containing Tele IDs. These represent the qualitative goals that guide the Turn's execution. When the Architect creates or updates a Turn, they assign relevant Tele goals.

### How the Architect Uses Tele

During proposal review and directive creation, the Architect can reference the active Turn's Tele goals to evaluate whether proposed work aligns with the declared aspirations. Tele serve as a compass — they don't enforce constraints but inform decision-making.

### Success Criteria

Each Tele has a `successCriteria` field (markdown) that describes measurable or observable targets. At Turn completion, the Architect can assess progress toward each Tele goal by comparing the Turn's outcomes against the success criteria.

---

## 5. Event Emission (SSE Policy)

All entity state changes emit SSE notifications via the Hub's persist-first notification pipeline (ADR-005).

### Event Types

| Event               | Entity  | Trigger                      | Target Roles          | Payload                          |
| ------------------- | ------- | ---------------------------- | --------------------- | -------------------------------- |
| `idea_submitted`    | Idea    | `submit_idea` called         | architect, engineer   | `{ ideaId, text (truncated), author }` |
| `mission_created`   | Mission | `create_mission` called      | architect, engineer   | `{ missionId, title }`           |
| `mission_activated` | Mission | `update_mission` status→active | architect, engineer | `{ missionId, title }`           |
| `turn_created`      | Turn    | `create_turn` called         | architect, engineer   | `{ turnId, title }`              |
| `turn_updated`      | Turn    | `update_turn` with status    | architect, engineer   | `{ turnId, title, status }`      |
| `tele_defined`      | Tele    | `define_tele` called         | architect, engineer   | `{ teleId, name }`              |

### Event Classification (Shared Event Router)

All new events are classified as **informational** for both roles in the shared `event-router.ts` (`@ois/network-adapter`). This means:
- **Engineer Plugin:** Toast notification shown, context injected silently (no LLM prompt)
- **Architect Agent:** Logged as informational, no sandwich handler triggered

---

## 6. Relationship Hierarchy

```
Tele (static axioms)
  ↓ referenced by
Turn (execution cycle)
  ├── missionIds[] → Mission (strategic arc)
  │                    ├── tasks[] → Task (atomic work unit)
  │                    │              └── correlationId links back to Mission
  │                    └── ideas[] → Idea (incorporated backlog items)
  └── taskIds[] → Task (direct assignment, no Mission grouping)

Thread (discussion) — orthogonal, referenced via correlationId or sourceThreadId
Idea.sourceThreadId → Thread (provenance tracking)
```

### Linkage Rules (Virtual View)

| Relationship                  | Source of truth                              | Read path                                             |
| ----------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| `mission.tasks` ← Task        | `task.correlationId` (set at `submit_directive`) | `MissionStore.getMission` filters tasks by `correlationId` |
| `mission.ideas` ← Idea        | `idea.missionId` (set at `update_idea`)      | `MissionStore.getMission` filters ideas by `missionId`     |

Properties:
- **No stored array:** the Mission entity's `tasks` / `ideas` fields are recomputed on every read; there is no append step to race against.
- **Idempotent by construction:** the source-of-truth field is a scalar on the linked entity, not a collection on the Mission.
- **Cross-store read coupling:** `MissionStore` takes `ITaskStore` and `IIdeaStore` as constructor deps and scans them on read. Scales with total tasks/ideas per mission read; fine at current scale, revisit if get_mission latency becomes a hot-path concern.
