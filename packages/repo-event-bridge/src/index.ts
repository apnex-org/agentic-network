/**
 * @ois/repo-event-bridge — sovereign repo-event bridge package.
 *
 * Mission-52 T1. EventSource pluggable contract + GH-event translator
 * + create_message sink stub for the OIS agentic network. See
 * README.md for the contract overview and thread-312 design provenance.
 */

export type {
  EventSource,
  EventSourceCapabilities,
  EventSourceHealth,
  RepoEvent,
} from "./event-source.js";

export {
  REPO_EVENT_SUBKINDS,
  translateGhEvent,
  dispatchSubkind,
  normalizeGhEvent,
} from "./translator.js";

export type { RepoEventSubkind } from "./translator.js";

export type {
  MessageSink,
  CreateMessageArgs,
  CreateMessageInvoker,
  CreateMessageSinkOptions,
} from "./sink.js";

export { CreateMessageSink } from "./sink.js";
