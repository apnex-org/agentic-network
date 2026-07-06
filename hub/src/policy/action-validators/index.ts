/**
 * Phase 2d CP2 C4 (task-307) — Action-validator registry bootstrap.
 *
 * Importing this file has the side effect of registering every
 * per-action validator. Policy-layer bootstrap imports this before the
 * first `create_thread_reply` handler ever runs.
 *
 * Action types without a state-reality concern (close_no_action,
 * create_idea, create_proposal, create_bug, propose_mission,
 * create_clarification) register the NULL_VALIDATOR — the payload-shape
 * check in `validateStagedActions` already covers their promotion-gate
 * semantics, and the cascade handler itself remains the transactional
 * arbiter.
 */
import { registerActionValidator } from "./registry.js";
import { NULL_VALIDATOR } from "./types.js";
import { updateMissionStatusValidator } from "./update-mission-status-validator.js";
import { updateIdeaValidator } from "./update-idea-validator.js";

// Real checks.
registerActionValidator("update_mission_status", updateMissionStatusValidator);
registerActionValidator("update_idea", updateIdeaValidator);

// Pass-through — no state-reality concern under the current schema.
registerActionValidator("close_no_action", NULL_VALIDATOR);
registerActionValidator("create_proposal", NULL_VALIDATOR);
registerActionValidator("create_idea", NULL_VALIDATOR);
registerActionValidator("propose_mission", NULL_VALIDATOR);
registerActionValidator("create_clarification", NULL_VALIDATOR); // revisit post-idea-125
registerActionValidator("create_bug", NULL_VALIDATOR);

export * from "./types.js";
export * from "./registry.js";
