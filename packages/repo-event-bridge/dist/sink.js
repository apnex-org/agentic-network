/**
 * MessageSink — sovereign-package contract for repo-event delivery.
 *
 * Mission-52 T1. Defines the contract that an EventSource consumer
 * uses to deliver translated `RepoEvent`s into the Hub. T1 ships the
 * interface + a stub implementation that calls mission-51 W6's
 * `create_message` MCP verb via an injected callable; T3 wires the
 * real Hub-side sink (in-process or out-of-process MCP transport,
 * authentication, retries) per the sovereign-package activation
 * directive.
 *
 * Why a stub at T1: the contract is the load-bearing artifact —
 * downstream T3 work composes any concrete `create_message` caller
 * against this surface, and T2 (PollSource) can wire its iterator
 * straight into a stub for end-to-end fixture replay without
 * standing up Hub transport.
 *
 * The stub deliberately avoids importing `@ois/network-adapter` or
 * any MCP-transport surface — keeping the package dep graph minimal
 * (per directive) and letting T3 choose the concrete transport
 * (in-process vs. MCP-stdio vs. MCP-HTTP) without re-shaping the
 * contract.
 */
/**
 * Stub sink that maps `RepoEvent` → `create_message` invocation. The
 * full `RepoEvent` envelope (`{kind, subkind, payload}`) is nested
 * under the Hub Message's `payload` field — sink-side dispatch in
 * the Hub reads `payload.kind === "repo-event"` to route, then
 * `payload.subkind` for per-type semantics.
 *
 * Concrete production sink (T3) may add: dedupe via
 * StorageProvider-backed seen-ids set, retry with backoff, batched
 * delivery, etc. The stub is deliberately minimal — it proves the
 * contract end-to-end via fixture replay.
 */
export class CreateMessageSink {
    invoke;
    messageKind;
    target;
    intent;
    semanticIntent;
    constructor(options) {
        this.invoke = options.invoke;
        this.messageKind = options.messageKind ?? "external-injection";
        this.target = options.target ?? null;
        this.intent = options.intent;
        this.semanticIntent = options.semanticIntent;
    }
    async emit(event) {
        await this.invoke({
            kind: this.messageKind,
            target: this.target,
            delivery: "push-immediate",
            payload: event,
            intent: this.intent,
            semanticIntent: this.semanticIntent,
        });
    }
}
//# sourceMappingURL=sink.js.map