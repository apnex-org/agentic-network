/**
 * EventSource — sovereign-package contract for repo-event ingestion.
 *
 * Mission-52 T1. Per thread-312 round-2 ratification, the contract is
 * an async-iterator pattern: implementations expose a `[Symbol.async-
 * Iterator]()` that yields `RepoEvent` values, plus lifecycle controls
 * (`start`/`stop`) and an operator self-service `health()` probe. This
 * shape composes naturally with backpressure (consumers pull at their
 * own rate) and with modern Node ergonomics (`for await...of`).
 *
 * Capability flags advertise the source's transport posture so the Hub
 * can pick a source per environment (poll for dev/CI; webhook for
 * prod) and so operators can reason about latency + dedupe guarantees
 * without inspecting impl internals.
 *
 * Translator output is a `RepoEvent`; sink consumers receive these via
 * the iterator. The translator itself lives in `./translator.ts`.
 */
export {};
//# sourceMappingURL=event-source.js.map