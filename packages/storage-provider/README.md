# @ois/storage-provider

Sovereign StorageProvider contract — CSI-inspired pluggable storage abstraction for the OIS agentic network.

Third sovereign package in the monorepo, sibling to `@ois/network-adapter` and `@ois/cognitive-layer`. Mission-47 deliverable; see [ADR-024](../../docs/decisions/024-sovereign-storage-provider.md) for the ratification.

## Contract v1.0

Six primitives; three capability flags:

```ts
interface ProviderCapabilities {
  readonly cas: boolean;
  readonly durable: boolean;
  readonly concurrent: boolean;
}

interface StorageProvider {
  readonly capabilities: ProviderCapabilities;
  get(path: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<string[]>;
  delete(path: string): Promise<void>;
  put(path: string, data: Uint8Array): Promise<void>;
  createOnly(path: string, data: Uint8Array): Promise<{ok:true}|{ok:false}>;
  putIfMatch(path: string, data: Uint8Array, ifMatchToken: string):
    Promise<{ok:true; newToken:string}|{ok:false; currentToken:string}>;
}
```

## Providers

| Name | cas | durable | concurrent | Use |
|---|---|---|---|---|
| `MemoryStorageProvider` | ✅ | ❌ | ❌ | Tests, dev (single-process). |
| `LocalFsStorageProvider` | ✅ | ✅ | ❌ | Local-dev hub; single-writer. CAS via O_EXCL + rename-swap. |
| `GcsStorageProvider` | ✅ | ✅ | ✅ | Production backend. |

`cas:false` is dev-only, not a supported deployment target.

## Tokens

Opaque strings. Compare equality only; don't parse. Tokens from one provider are not portable to another.

## Testing

Single CSI-style contract-conformance suite in `test/conformance.ts` runs against every provider. Bugs in conformance = bugs in the contract; bugs in a provider = one provider disagrees with the others.

```bash
npm test      # 40 tests × 2 providers (memory + local-fs) in <1s
```

GCS conformance is validated against a real bucket out-of-band (not in CI).

## Usage

```ts
import { MemoryStorageProvider } from "@ois/storage-provider";

const provider = new MemoryStorageProvider();
await provider.put("bugs/bug-1.json", new TextEncoder().encode('{"id":"bug-1"}'));
const raw = await provider.get("bugs/bug-1.json");
// raw is Uint8Array or null
```

Entity repositories compose the provider + own serialization + ID generation:

```ts
class BugRepository {
  constructor(private readonly provider: StorageProvider) {}
  async get(id: string): Promise<Bug | null> {
    const raw = await this.provider.get(`bugs/${id}.json`);
    return raw ? JSON.parse(new TextDecoder().decode(raw)) : null;
  }
  // ... etc
}
```

## Related

- [ADR-024 — Sovereign StorageProvider](../../docs/decisions/024-sovereign-storage-provider.md) — design ratification.
- [`@ois/network-adapter`](../network-adapter/) — first sovereign-package precedent.
- [`@ois/cognitive-layer`](../cognitive-layer/) — second sovereign-package precedent.
