/**
 * stdio-linked-transport — in-process pair of real MCP stdio transports.
 *
 * Uses the SDK's production `StdioServerTransport` (which accepts custom
 * Readable/Writable pairs via constructor) wired against a client-side
 * counterpart built from the same SDK primitives (`ReadBuffer`,
 * `serializeMessage`). NDJSON framing is identical to what production
 * `StdioServerTransport` / `StdioClientTransport` use — the only thing
 * swapped is the physical byte channel (PassThrough streams instead of
 * OS pipes), because PassThrough avoids the subprocess spawn cost.
 *
 * Diagnostic value: isolates MCP wire-format framing from OS-pipe buffer
 * semantics. If truncation reproduces here, the bug is in JSON-RPC
 * marshaling or the ReadBuffer splitter. If truncation does NOT reproduce
 * but DOES reproduce under real OS-pipe stdio (subprocess variant), the
 * bug is at the OS-pipe boundary.
 */

import { PassThrough } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * InProcessStdioClientTransport — mirrors SDK's StdioClientTransport
 * NDJSON framing without spawning a subprocess. Reads inbound bytes
 * from a caller-provided Readable, writes outbound bytes to a
 * caller-provided Writable.
 */
export class InProcessStdioClientTransport implements Transport {
  private readonly _readBuffer = new ReadBuffer();
  private _started = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private readonly _stdin: NodeJS.ReadableStream,
    private readonly _stdout: NodeJS.WritableStream,
  ) {}

  private readonly _ondata = (chunk: Buffer) => {
    this._readBuffer.append(chunk);
    this._processReadBuffer();
  };

  private readonly _onerror = (error: Error) => {
    this.onerror?.(error);
  };

  async start(): Promise<void> {
    if (this._started) {
      throw new Error("InProcessStdioClientTransport already started");
    }
    this._started = true;
    this._stdin.on("data", this._ondata);
    this._stdin.on("error", this._onerror);
  }

  private _processReadBuffer(): void {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) break;
        this.onmessage?.(message);
      } catch (err) {
        this.onerror?.(err as Error);
      }
    }
  }

  async close(): Promise<void> {
    this._stdin.off("data", this._ondata);
    this._stdin.off("error", this._onerror);
    this._readBuffer.clear();
    this.onclose?.();
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      const json = serializeMessage(message);
      if (this._stdout.write(json)) {
        resolve();
      } else {
        this._stdout.once("drain", () => resolve());
      }
    });
  }
}

export interface LinkedStdioPair {
  serverTransport: StdioServerTransport;
  clientTransport: InProcessStdioClientTransport;
  dispose: () => void;
}

/**
 * Creates an in-process pair of MCP stdio transports wired via PassThrough.
 *
 * The server-side transport is the production `StdioServerTransport` with
 * custom Readable/Writable injected — identical code path to a subprocess
 * shim's stdio server. The client-side transport mirrors the SDK's NDJSON
 * framing via shared primitives.
 */
export function createLinkedStdioPair(): LinkedStdioPair {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const serverTransport = new StdioServerTransport(clientToServer, serverToClient);
  const clientTransport = new InProcessStdioClientTransport(serverToClient, clientToServer);
  return {
    serverTransport,
    clientTransport,
    dispose() {
      try {
        clientToServer.end();
      } catch {
        /* ignore */
      }
      try {
        serverToClient.end();
      } catch {
        /* ignore */
      }
    },
  };
}
