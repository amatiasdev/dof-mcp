import { readFileSync } from "node:fs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDofHttpHandler,
  DofClient,
  type DofHttpHandler,
  todayInMexico,
} from "../src/index.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8"));
}

/** Serves recorded SIDOF responses by path, like the live API would. */
const routes: Record<string, unknown> = {
  "/dof/sidof/notas/16-10-2026": fixture("notas-16-10-2026.json"),
  "/dof/sidof/notas/nota/5801457": fixture("nota-5801457.json"),
  "/dof/sidof/indicadores/16-10-2026": fixture("indicadores-16-10-2026.json"),
  "/dof/sidof/indicadores/158/01-10-2026/16-10-2026": fixture(
    "indicadores-158-01-10-2026-16-10-2026.json",
  ),
};

const sidofFetch: typeof fetch = async (input) => {
  const { pathname } = new URL(input instanceof Request ? input.url : input);
  const body = routes[pathname];
  return body === undefined
    ? new Response("{}", { status: 500 })
    : Response.json(body, { headers: { "Content-Type": "application/json;charset=UTF-8" } });
};

let handler: DofHttpHandler | undefined;
let client: Client | undefined;

async function connect(): Promise<Client> {
  handler = createDofHttpHandler({ client: new DofClient({ fetch: sidofFetch, retries: 0 }) });
  const served = handler;
  client = new Client({ name: "dof-mcp-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: (url, init) => served.fetch(new Request(url, init)),
    }),
  );
  return client;
}

afterEach(async () => {
  await client?.close();
  await handler?.close();
  client = undefined;
  handler = undefined;
});

async function call(name: string, args: Record<string, unknown>) {
  const mcp = await connect();
  const result = await mcp.callTool({ name, arguments: args });
  return result as {
    isError?: boolean;
    content: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
  };
}

describe("tools/list", () => {
  it("exposes the read-only DOF tools", async () => {
    const mcp = await connect();
    const { tools } = await mcp.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      "dof_daily_summary",
      "dof_get_indicators",
      "dof_get_note",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.outputSchema).toBeDefined();
    }
  });
});

describe("dof_daily_summary", () => {
  it("summarizes a day with counts, ids and official links", async () => {
    const result = await call("dof_daily_summary", { date: "2026-10-16" });
    const out = result.structuredContent as {
      total: number;
      byEdition: Record<string, number>;
      notes: { id: number; officialUrl: string }[];
      truncated: boolean;
    };

    expect(result.isError).toBeFalsy();
    expect(out.total).toBeGreaterThan(0);
    expect(Object.values(out.byEdition).reduce((a, b) => a + b, 0)).toBe(out.total);
    expect(out.notes.some((n) => n.id === 5801457)).toBe(true);
    expect(out.notes[0]?.officialUrl).toMatch(
      /^https:\/\/dof\.gob\.mx\/nota_detalle\.php\?codigo=\d+&fecha=16\/10\/2026$/,
    );
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(out);
    expect(result.structuredContent?.provenance).toMatchObject({
      sourceUrl: "https://sidof.segob.gob.mx/dof/sidof/notas/16-10-2026",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("filters by organization and truncates to the limit", async () => {
    const result = await call("dof_daily_summary", {
      date: "2026-10-16",
      organization: "hacienda",
      limit: 1,
    });
    const out = result.structuredContent as {
      total: number;
      notes: { organization?: string }[];
      truncated: boolean;
    };

    expect(out.total).toBeGreaterThan(1);
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]?.organization).toMatch(/HACIENDA/);
    expect(out.truncated).toBe(true);
  });

  it("reports an upstream failure as a tool error", async () => {
    const result = await call("dof_daily_summary", { date: "2026-10-15" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/SIDOF request failed/);
  });
});

describe("dof_get_note", () => {
  it("returns the note text as plain text", async () => {
    const result = await call("dof_get_note", { id: 5801457 });
    const out = result.structuredContent as {
      title: string;
      text: string;
      organizations: string[];
      totalChars: number;
      nextOffset?: number;
    };

    expect(out.title).toMatch(/^Acuerdo por el que se dan a conocer/);
    expect(out.organizations).toEqual(["SECRETARIA DE HACIENDA Y CREDITO PUBLICO"]);
    expect(out.text).not.toMatch(/<[a-z]/i);
    expect(out.text).toMatch(/Rúbrica/);
    expect(out.nextOffset).toBeUndefined();
    expect(out.text).toHaveLength(out.totalChars);
  });

  it("pages long text with offset and maxChars", async () => {
    const first = await call("dof_get_note", { id: 5801457, maxChars: 1000 });
    const page = first.structuredContent as { text: string; nextOffset?: number };
    expect(page.text).toHaveLength(1000);
    expect(page.nextOffset).toBe(1000);

    const second = await call("dof_get_note", { id: 5801457, offset: 1000, maxChars: 1000 });
    expect((second.structuredContent as { offset: number }).offset).toBe(1000);
  });
});

describe("dof_get_indicators", () => {
  it("returns the indicators published on a day", async () => {
    const result = await call("dof_get_indicators", { date: "2026-10-16" });
    const { indicators } = result.structuredContent as {
      indicators: { key?: string; value: number }[];
    };

    expect(indicators.find((i) => i.key === "fix")?.value).toBe(18.425);
    expect(indicators.find((i) => i.key === "tiie28")?.value).toBe(6.7659);
  });

  it("returns a series for one indicator", async () => {
    const result = await call("dof_get_indicators", {
      indicator: "fix",
      from: "2026-10-01",
      to: "2026-10-16",
    });
    const { indicators } = result.structuredContent as { indicators: { key?: string }[] };

    expect(indicators.length).toBeGreaterThan(1);
    expect(indicators.every((i) => i.key === "fix")).toBe(true);
  });

  it.each([
    [{ indicator: "fix", from: "2026-10-01" }, /needs indicator, from and to/],
    [{ indicator: "fix", from: "2026-10-16", to: "2026-10-01" }, /on or before/],
    [{ indicator: "fix", from: "2024-01-01", to: "2026-01-01" }, /too long/],
  ])("rejects invalid series arguments %j", async (args, message) => {
    const result = await call("dof_get_indicators", args);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(message);
  });
});

describe("HTTP handler", () => {
  it("answers the health probe", async () => {
    handler = createDofHttpHandler();
    const res = await handler.fetch(new Request("http://localhost/healthz"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("returns 404 outside the MCP path", async () => {
    handler = createDofHttpHandler();
    const res = await handler.fetch(new Request("http://localhost/other"));

    expect(res.status).toBe(404);
  });

  it("rejects foreign browser origins", async () => {
    handler = createDofHttpHandler();
    const res = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    expect(res.status).toBe(403);
  });

  it("rejects unexpected Host headers", async () => {
    handler = createDofHttpHandler();
    const res = await handler.fetch(new Request("http://attacker.example/healthz"));

    expect(res.status).toBe(403);
  });
});

describe("todayInMexico", () => {
  it("uses the Mexico City calendar day", () => {
    // 03:00 UTC on Oct 17 is still Oct 16 in Mexico City (UTC-6).
    expect(todayInMexico(new Date("2026-10-17T03:00:00Z"))).toBe("2026-10-16");
  });
});
