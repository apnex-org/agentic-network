# Mission Lifecycle - Mermaid Diagram Set

**Status:** Draft companion diagram set generated from current methodology docs.
**Primary source:** `docs/methodology/mission-lifecycle.md` v1.2.
**Supporting sources:** `idea-survey.md`, `mission-preflight.md`, `multi-agent-pr-workflow.md`, `entity-mechanics.md`, `trace-management.md`, `strategic-review.md`.

## How to use this document

This document is a visual companion to the methodology. It does not replace the source documents. Use the diagrams as follows:

- **Lifecycle overview:** stakeholder-level view of the 10 macro phases.
- **Role swimlane:** operating model and handoffs across Director, Architect, Engineer, Hub, and GitHub.
- **Preflight and release gate:** detailed activation logic for `proposed -> active`.
- **Execution wave loop:** detailed Phase 8 mechanics across threads, PRs, review, merge, trace, and cascade behavior.
- **Entity state appendix:** implementation-facing FSM reference for the main Hub entities.

The legacy 7-phase lifecycle audit preserved in `mission-lifecycle.md` Appendix A is not the canonical source for these diagrams. These diagrams use the current 10-phase lifecycle.

## 1. Mission Lifecycle Overview

```mermaid
flowchart LR
  Concept["1 Concept<br/>Workflow concept surfaced"] --> Idea["2 Idea<br/>create_idea<br/>open to triaged"]
  Idea --> Survey["3 Survey<br/>Architect 3+3 questions<br/>Director picks intent envelope"]
  Survey --> Design["4 Design<br/>Architect + Engineer<br/>Design v0.1 to v1.0"]
  Idea -.->|bypass allowed for bug-fix or scoped spawned idea| Design
  Design --> Manifest["5 Manifest<br/>create_mission<br/>status: proposed<br/>plannedTasks + missionClass"]
  Manifest --> Preflight["6 Preflight<br/>Architect authors artifact<br/>verdict: GREEN / YELLOW / RED"]
  Preflight --> Gate{"7 Release gate<br/>Director ratifies?"}
  Gate -->|yes| Active["Mission status<br/>proposed to active"]
  Gate -->|redirect| Rework["Refresh brief<br/>or abandon mission"]
  Rework --> Preflight
  Rework -.->|abandon path| Abandoned["Mission status<br/>abandoned"]
  Active --> Execution["8 Execution<br/>W0-Wn wave cascade<br/>PR + cross-approval + merge"]
  Execution --> Close["9 Close<br/>closing wave + audit<br/>active to completed"]
  Close --> RetroMode{"10 Retrospective<br/>mode pick"}
  RetroMode -->|structural / substrate| Walkthrough["Walkthrough<br/>Director-paced review"]
  RetroMode -->|standard mission| Summary["Summary-review<br/>architect doc + Director review"]
  RetroMode -->|spike / cleanup / rare bug-fix| Skip["Skip<br/>closing audit sufficient"]
  Walkthrough --> Done["Mission lifecycle complete"]
  Summary --> Done
  Skip --> Done

  classDef director fill:#fff3cd,stroke:#b58b00,color:#1f1f1f
  classDef hub fill:#e7f1ff,stroke:#2f6fed,color:#1f1f1f
  classDef terminal fill:#e9f7ef,stroke:#22863a,color:#1f1f1f
  class Survey,Gate,RetroMode director
  class Idea,Manifest,Active,Abandoned,Close hub
  class Done terminal
```

## 2. Role Swimlane

```mermaid
flowchart TB
  subgraph DIR["Director"]
    D1["Surface or accept concept"]
    D2["Pick Survey answers<br/>Round 1 + Round 2"]
    D3["Ratify release gate<br/>after preflight"]
    D4["Pick and ratify<br/>retrospective mode"]
  end

  subgraph ARCH["Architect"]
    A1["File and triage Idea"]
    A2["Design Survey questions<br/>interpret response matrix"]
    A3["Draft Design<br/>v0.1 to v1.0"]
    A4["Create Mission manifest<br/>plannedTasks + missionClass"]
    A5["Author preflight artifact"]
    A6["Flip Mission active<br/>after Director ratification"]
    A7["Dispatch waves<br/>coordinate cross-approval<br/>admin-merge when warranted"]
    A8["Close mission<br/>draft retrospective"]
  end

  subgraph ENG["Engineer"]
    E1["Design audit<br/>round 1 + round 2"]
    E2["Verify execution readiness<br/>when claim lane applies"]
    E3["Claim wave or task<br/>implement work"]
    E4["Open PR<br/>maintain work trace<br/>respond to review"]
    E5["Closing audit<br/>final verification"]
  end

  subgraph HUB["Hub"]
    H1["Idea entity<br/>open to triaged to incorporated"]
    H2["Mission entity<br/>proposed to active to completed"]
    H3["Threads<br/>dispatch, review, convergence"]
    H4["Messages and pulses<br/>status checks and escalation"]
    H5["Task / plannedTasks cascade<br/>when formal task path is used"]
  end

  subgraph GH["GitHub"]
    G1["Feature branch"]
    G2["Pull request"]
    G3["CODEOWNERS review<br/>CI gates"]
    G4["Squash merge<br/>main updated"]
  end

  D1 --> A1 --> H1 --> A2 --> D2 --> A3
  A3 <--> E1
  A3 --> A4 --> H2
  A4 --> A5
  A5 <--> E2
  A5 --> D3 --> A6 --> H2
  H2 --> A7 --> H3 --> E3 --> G1 --> G2 --> G3 --> G4
  G4 --> E4 --> H3
  G4 --> H5
  H4 -.->|recurring coordination during active mission| A7
  H4 -.->|status pulse| E3
  A7 --> E5 --> A8 --> H2 --> D4

  Mediation["Mediation invariant:<br/>Director and Engineer routine mechanics route through Architect"]
  D3 -.-> Mediation
  Mediation -.-> A7
  A7 -.-> E3

  classDef director fill:#fff3cd,stroke:#b58b00,color:#1f1f1f
  classDef architect fill:#f3e8ff,stroke:#7e3fb2,color:#1f1f1f
  classDef engineer fill:#e9f7ef,stroke:#22863a,color:#1f1f1f
  classDef system fill:#e7f1ff,stroke:#2f6fed,color:#1f1f1f
  classDef note fill:#f6f8fa,stroke:#8c959f,color:#1f1f1f
  class D1,D2,D3,D4 director
  class A1,A2,A3,A4,A5,A6,A7,A8 architect
  class E1,E2,E3,E4,E5 engineer
  class H1,H2,H3,H4,H5,G1,G2,G3,G4 system
  class Mediation note
```

## 3. Preflight And Release Gate

```mermaid
flowchart TD
  Proposed["Mission status: proposed"] --> Load["Step 1<br/>Architect loads mission brief,<br/>mission entity, and referenced artifacts"]
  Load --> Audit["Step 2<br/>Run six preflight categories"]

  Audit --> A["A Documentation integrity"]
  Audit --> B["B Hub filing integrity"]
  Audit --> C["C Referenced-artifact currency"]
  Audit --> D["D Scope-decision gating"]
  Audit --> E["E Execution readiness"]
  Audit --> F["F Coherence with current priorities"]

  A --> Artifact["Step 4<br/>File preflight artifact<br/>docs/missions/&lt;mission-id&gt;-preflight.md"]
  B --> Artifact
  C --> Artifact
  D --> Artifact
  E --> Artifact
  F --> Artifact

  Artifact --> Fresh{"Preflight current?<br/>30-day freshness window"}
  Fresh -->|stale| Load
  Fresh -->|current| Verdict{"Step 3<br/>Verdict"}

  Verdict -->|GREEN| Ratify["Director release-gate ratification"]
  Ratify --> Active["update_mission<br/>status: active"]
  Active --> Execution["Enter Phase 8 Execution"]

  Verdict -->|YELLOW<br/>only Category D unresolved| Kickoff["Short kickoff<br/>Director + Architect + Engineer<br/>ratify open scope decisions"]
  Kickoff --> GreenUpdate["Update artifact<br/>verdict becomes GREEN"]
  GreenUpdate --> Ratify

  Verdict -->|RED<br/>A/B/C/E/F blocker| RedPath{"RED disposition"}
  RedPath --> Refresh["Brief refresh<br/>then rerun preflight"]
  Refresh --> Load
  RedPath --> Abandon["update_mission<br/>status: abandoned"]

  classDef director fill:#fff3cd,stroke:#b58b00,color:#1f1f1f
  classDef architect fill:#f3e8ff,stroke:#7e3fb2,color:#1f1f1f
  classDef engineer fill:#e9f7ef,stroke:#22863a,color:#1f1f1f
  classDef hub fill:#e7f1ff,stroke:#2f6fed,color:#1f1f1f
  classDef bad fill:#ffebe9,stroke:#cf222e,color:#1f1f1f
  class Ratify,Verdict,Fresh,RedPath director
  class Load,Audit,Artifact,Refresh,GreenUpdate architect
  class Kickoff engineer
  class Proposed,Active,Abandon hub
  class Abandon bad
```

## 4. Execution Wave And PR Loop

```mermaid
sequenceDiagram
  autonumber
  participant A as Architect
  participant E as Engineer
  participant H as Hub
  participant G as GitHub
  participant D as Docs

  A->>H: Dispatch wave thread with mission correlationId
  H-->>E: Wave available by thread/message/pulse surface

  loop For each wave W0-Wn
    E->>H: Engage thread and claim work
    E->>D: Update work trace resumption pointer and in-flight state
    E->>G: Create feature branch and push commits
    E->>G: Open PR with mission/task context and test plan
    E->>H: Notify Architect via PR-review thread
    A->>G: Review PR diff and CI status

    alt Changes required
      A->>G: Request changes
      A->>H: Reply on PR-review thread with rationale
      E->>G: Push revisions
      E->>H: Re-notify if scope changed materially
    else Approved
      A->>G: Approve PR
      A->>G: Merge via queue or admin squash merge when warranted
      G-->>A: Main updated
      A->>H: Seal PR-review thread with convergence summary
      E->>D: Update work trace with landed commits and verification
    end

    alt Formal Task entity path
      E->>H: create_report with landed commit and verification
      A->>H: create_review approved or revision_required
      H-->>E: plannedTasks cascade issues next task when approved
    else Thread-dispatch path
      A->>H: Dispatch next wave thread after merge and seal
    end
  end

  A->>H: Final wave complete; set mission status completed
  E->>D: Author closing audit or final verification content
  A->>D: Author retrospective when selected
```

## 5. Entity State Appendix

```mermaid
stateDiagram-v2
  state Idea {
    [*] --> IdeaOpen
    IdeaOpen: open
    IdeaTriaged: triaged
    IdeaIncorporated: incorporated
    IdeaDismissed: dismissed
    IdeaOpen --> IdeaTriaged: triage
    IdeaTriaged --> IdeaIncorporated: linked to Mission
    IdeaTriaged --> IdeaDismissed: not pursued
  }

  state Mission {
    [*] --> MissionProposed
    MissionProposed: proposed
    MissionActive: active
    MissionCompleted: completed
    MissionAbandoned: abandoned
    MissionProposed --> MissionActive: release gate ratified
    MissionActive --> MissionCompleted: final wave closed
    MissionProposed --> MissionAbandoned: RED disposition or scope failure
    MissionActive --> MissionAbandoned: rare execution failure
  }

  state Task {
    [*] --> TaskPending
    TaskPending: pending
    TaskWorking: working
    TaskNeedsReview: needs_review
    TaskCompleted: completed
    TaskAbandoned: abandoned
    TaskPending --> TaskWorking: engineer claim
    TaskWorking --> TaskNeedsReview: create_report
    TaskNeedsReview --> TaskCompleted: approved review
    TaskNeedsReview --> TaskWorking: revision_required
    TaskPending --> TaskAbandoned: cancelled
    TaskWorking --> TaskAbandoned: cancelled
  }

  state Thread {
    [*] --> ThreadActive
    ThreadActive: active
    ThreadConverged: converged
    ThreadRoundLimit: round_limit
    ThreadClosed: closed
    ThreadAbandoned: abandoned
    ThreadCascadeFailed: cascade_failed
    ThreadActive --> ThreadConverged: bilateral seal + staged actions
    ThreadActive --> ThreadRoundLimit: max rounds reached
    ThreadActive --> ThreadClosed: close action
    ThreadActive --> ThreadAbandoned: abandoned
    ThreadActive --> ThreadCascadeFailed: staged action failure
  }

  state Message {
    [*] --> MessageNew
    MessageNew: new
    MessageReceived: received
    MessageAcked: acked
    MessageNew --> MessageReceived: claim_message
    MessageReceived --> MessageAcked: ack_message
  }
```

## Source-to-diagram map

| Diagram | Primary source sections |
|---|---|
| Mission Lifecycle Overview | `mission-lifecycle.md` sections 1, 1.x, 2, 3, 4, 5, 6, 7 |
| Role Swimlane | `mission-lifecycle.md` section 1.5 RACI matrix; `multi-agent-pr-workflow.md` roles and procedure |
| Preflight And Release Gate | `mission-preflight.md` procedure, verdict table, stale-preflight trigger |
| Execution Wave And PR Loop | `mission-lifecycle.md` section 7; `multi-agent-pr-workflow.md` per-PR lifecycle; `trace-management.md` trace discipline |
| Entity State Appendix | `entity-mechanics.md` entity catalog and FSM sections |
