import { timingSafeEqual } from "node:crypto";
import {
  createMcpHandler,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
  validateHostHeader,
} from "@modelcontextprotocol/server";
import { DofClient } from "./client.js";
import { createDofServer } from "./server.js";
import { VERSION } from "./version.js";

export interface DofHttpHandlerOptions {
  client?: DofClient;
  /** Path the MCP endpoint is served on. Defaults to "/mcp". */
  path?: string;
  /** Hostnames accepted in the Host header (DNS rebinding protection). Defaults to localhost. */
  allowedHosts?: string[];
  /** Hostnames accepted in the Origin header, when a browser sends one. Defaults to localhost. */
  allowedOrigins?: string[];
  /**
   * A header every request must carry with this exact value, e.g. one a CDN adds in front of a
   * public deployment so traffic that bypasses the CDN is refused. `/healthz` is exempt.
   */
  requiredHeader?: { name: string; value: string };
  /** Largest request body accepted, in bytes. Defaults to the MCP SDK's 4 MiB. */
  maxRequestBodySize?: number;
  /**
   * Open `subscriptions/listen` streams allowed at once. Defaults to the SDK's 1024; set it to
   * 0 on runtimes that buffer responses (such as AWS Lambda), where a stream never ends.
   */
  maxSubscriptions?: number;
}

export interface DofHttpHandler {
  fetch: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
}

function jsonRpcError(status: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, { status });
}

/** Compares secrets in constant time, so response timing does not reveal how much matched. */
function sameSecret(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Web-standard handler serving the DOF tools over stateless Streamable HTTP, plus a
 * `GET /healthz` probe. Runs on any fetch-native runtime; wrap it with `toNodeHandler`
 * from `@modelcontextprotocol/node` for `node:http`.
 */
export function createDofHttpHandler(options: DofHttpHandlerOptions = {}): DofHttpHandler {
  const client = options.client ?? new DofClient();
  const path = options.path ?? "/mcp";
  const allowedHosts = options.allowedHosts ?? localhostAllowedHostnames();
  const allowedOrigins = options.allowedOrigins ?? localhostAllowedOrigins();
  const { requiredHeader } = options;
  const mcp = createMcpHandler(() => createDofServer(client), {
    legacy: "stateless",
    ...(options.maxRequestBodySize !== undefined
      ? { maxRequestBodySize: options.maxRequestBodySize }
      : {}),
    ...(options.maxSubscriptions !== undefined
      ? { maxSubscriptions: options.maxSubscriptions }
      : {}),
  });

  return {
    fetch: async (request) => {
      const url = new URL(request.url);
      // Fails closed: a request without a Host header is rejected.
      const hostResult = validateHostHeader(request.headers.get("host"), allowedHosts);
      if (!hostResult.ok) return jsonRpcError(403, hostResult.message);
      const rejected = originValidationResponse(request, allowedOrigins);
      if (rejected) return rejected;

      const { pathname } = url;
      if (pathname === "/healthz" && request.method === "GET") {
        return Response.json({ status: "ok", version: VERSION });
      }
      if (
        requiredHeader &&
        !sameSecret(request.headers.get(requiredHeader.name), requiredHeader.value)
      ) {
        return jsonRpcError(403, "Forbidden");
      }
      if (pathname === path) return mcp.fetch(request);
      return new Response("Not found", { status: 404 });
    },
    close: () => mcp.close(),
  };
}
