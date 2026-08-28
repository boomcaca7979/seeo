import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/** One-shot Web adapter for Next Route Handlers. MCP state is intentionally request-scoped. */
export class WebMcpTransport implements Transport {
  private response: JSONRPCMessage | null = null;
  private resolveResponse!: (message: JSONRPCMessage) => void;
  readonly responsePromise = new Promise<JSONRPCMessage>((resolve) => { this.resolveResponse = resolve; });

  constructor(private readonly body: unknown) {}

  async start() {
    queueMicrotask(() => {
      this.onmessage?.(this.body as JSONRPCMessage);
    });
  }

  async send(message: JSONRPCMessage) {
    this.response = message;
    this.resolveResponse(message);
  }

  async close() {}
  get sentResponse() { return this.response; }
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
}
