/**
 * Layer-2 Message envelope — the routable unit consumed by `MessageRouter`.
 *
 * The `kind` discriminator partitions messages across the five v1.0
 * dispatch buckets defined in the Universal Adapter notification
 * contract spec (`docs/specs/universal-adapter-notification-contract.md`)
 * plus the mission-52 `repo-event` bridge.
 *
 * Subkind discrimination (e.g., `event.event` for AgentEvent payloads)
 * remains forward-compat extension scope (W3+); v1.0 routing is
 * kind-only per Design v1.2 §"Architectural commitments #4".
 */
export {};
//# sourceMappingURL=message.js.map