/**
 * Cascade action handlers — aggregated registration module.
 *
 * Importing this file has the side effect of registering all
 * per-action-type cascade handlers with the central cascade.ts
 * registry. thread-policy.ts imports this once at module-load time
 * so every convergence path finds the handlers present.
 *
 * Adding a new cascade action type: create the handler file here and
 * add its import to the list below. Registration happens at module
 * load — no explicit wiring call needed.
 */

import "./close-no-action.js";
// proptool0: create_proposal cascade action retired from the active
// convergence vocabulary. Keep Proposal storage/history, but do not register
// a hidden Proposal-creation path.
import "./create-idea.js";
import "./update-idea.js";
import "./update-mission-status.js";
import "./propose-mission.js";
import "./create-clarification.js";
import "./create-bug.js";
