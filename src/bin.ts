#!/usr/bin/env node
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { type NodeIncomingMessageLike, toNodeHandler } from "@modelcontextprotocol/node";
import { localhostAllowedHostnames } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createDofHttpHandler } from "./http.js";
import { createDofServer } from "./server.js";
import { VERSION } from "./version.js";

const USAGE = `dof-mcp ${VERSION}: MCP server for Mexico's Diario Oficial de la Federación

Usage:
  dof-mcp                       serve over stdio (default)
  dof-mcp --http [options]      serve over Streamable HTTP at /mcp

HTTP options:
  --port <n>                    port to listen on (default 3000)
  --host <addr>                 address to bind (default 127.0.0.1)
  --allowed-host <name>         extra hostname accepted in the Host header (repeatable)
`;

const { values } = parseArgs({
  options: {
    http: { type: "boolean", default: false },
    port: { type: "string", default: "3000" },
    host: { type: "string", default: "127.0.0.1" },
    "allowed-host": { type: "string", multiple: true, default: [] },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
  },
});

if (values.help) {
  process.stdout.write(USAGE);
} else if (values.version) {
  process.stdout.write(`${VERSION}\n`);
} else if (values.http) {
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    process.stderr.write(`Invalid --port "${values.port}"\n`);
    process.exit(1);
  }
  if (!["127.0.0.1", "::1", "localhost"].includes(values.host)) {
    process.stderr.write(
      `Warning: binding to ${values.host}. Host and Origin checks guard against DNS rebinding, ` +
        "not unauthorized access; this server has no authentication or rate limiting. Put it " +
        "behind a reverse proxy that adds them.\n",
    );
  }
  const handler = createDofHttpHandler({
    allowedHosts: [...localhostAllowedHostnames(), ...values["allowed-host"]],
  });
  const nodeHandler = toNodeHandler(handler);
  // node:http always sets `method` on server requests; the adapter's type just doesn't know it.
  const server = createServer((req, res) => void nodeHandler(req as NodeIncomingMessageLike, res));
  server.listen(port, values.host, () => {
    process.stderr.write(`dof-mcp ${VERSION} listening on http://${values.host}:${port}/mcp\n`);
  });
} else {
  serveStdio(() => createDofServer());
}
