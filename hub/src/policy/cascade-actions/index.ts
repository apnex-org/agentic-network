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

import "./create-task.js";
import "./create-proposal.js";
import "./create-idea.js";
