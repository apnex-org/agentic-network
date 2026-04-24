import { describe, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LocalFsStorageProvider } from "../src/local-fs.js";
import { runConformanceSuite } from "./conformance.js";

describe("LocalFsStorageProvider — conformance", () => {
  let rootDir: string;

  beforeAll(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ois-storage-provider-test-"));
  });

  afterAll(async () => {
    if (rootDir) {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  // Fresh subdirectory per test so state doesn't leak between cases.
  let testCounter = 0;
  runConformanceSuite(() => {
    testCounter++;
    const caseRoot = path.join(rootDir, `case-${testCounter}`);
    return new LocalFsStorageProvider(caseRoot);
  });
});
