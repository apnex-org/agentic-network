import { describe } from "vitest";
import { MemoryStorageProvider } from "../src/memory.js";
import { runConformanceSuite } from "./conformance.js";

describe("MemoryStorageProvider — conformance", () => {
  runConformanceSuite(() => new MemoryStorageProvider());
});
