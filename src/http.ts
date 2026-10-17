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
}

export interface DofHttpHandler {
  fetch: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
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
  const mcp = createMcpHandler(() => createDofServer(client), { legacy: "stateless" });

  return {
    fetch: async (request) => {
      const url = new URL(request.url);
      const host = request.headers.get("host") ?? url.host;
      const hostResult = validateHostHeader(host, allowedHosts);
      if (!hostResult.ok) {
        return Response.json(
          { jsonrpc: "2.0", error: { code: -32000, message: hostResult.message }, id: null },
          { status: 403 },
        );
      }
      const rejected = originValidationResponse(request, allowedOrigins);
      if (rejected) return rejected;

      const { pathname } = url;
      if (pathname === "/healthz" && request.method === "GET") {
        return Response.json({ status: "ok", version: VERSION });
      }
      if (pathname === path) return mcp.fetch(request);
      return new Response("Not found", { status: 404 });
    },
    close: () => mcp.close(),
  };
}
