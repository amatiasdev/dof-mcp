import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { citeNote, DofClient } from "../src/index.js";
import {
  createLambdaHandler,
  type HttpApiEvent,
  ORIGIN_SECRET_HEADER,
  readLambdaConfig,
  toRequest,
  toResult,
} from "../src/lambda.js";

const SECRET = "s".repeat(40);
const HOST = "mcp.example.com";
const env = { DOF_ALLOWED_HOSTS: HOST, DOF_ORIGIN_SECRET: SECRET };

const notas = JSON.parse(
  readFileSync(new URL("./fixtures/notas-16-10-2026.json", import.meta.url), "utf-8"),
);

const sidofFetch: typeof fetch = async () => Response.json(notas);

function event(overrides: Partial<HttpApiEvent> & { method?: string } = {}): HttpApiEvent {
  const { method = "POST", ...rest } = overrides;
  return {
    rawPath: "/mcp",
    rawQueryString: "",
    headers: {
      host: HOST,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      [ORIGIN_SECRET_HEADER]: SECRET,
    },
    isBase64Encoded: false,
    requestContext: { domainName: HOST, http: { method } },
    ...rest,
  };
}

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
});

describe("readLambdaConfig", () => {
  it("reads hosts and the origin secret", () => {
    expect(
      readLambdaConfig({ DOF_ALLOWED_HOSTS: " a.com , b.com ", DOF_ORIGIN_SECRET: SECRET }),
    ).toEqual({ allowedHosts: ["a.com", "b.com"], originSecret: SECRET });
  });

  it.each([
    [{ DOF_ORIGIN_SECRET: SECRET }, /DOF_ALLOWED_HOSTS/],
    [{ DOF_ALLOWED_HOSTS: HOST }, /DOF_ORIGIN_SECRET/],
    [{ DOF_ALLOWED_HOSTS: HOST, DOF_ORIGIN_SECRET: "short" }, /at least 32/],
  ])("refuses to start without a complete configuration (%j)", (partial, message) => {
    expect(() => createLambdaHandler({ env: partial })).toThrow(message);
  });
});

describe("toRequest / toResult", () => {
  it("rebuilds the URL, headers, cookies and a base64 body", async () => {
    const request = toRequest(
      event({
        rawQueryString: "a=1",
        cookies: ["x=1", "y=2"],
        body: Buffer.from("hola").toString("base64"),
        isBase64Encoded: true,
      }),
    );

    expect(request.url).toBe(`https://${HOST}/mcp?a=1`);
    expect(request.headers.get("cookie")).toBe("x=1; y=2");
    expect(await request.text()).toBe("hola");
  });

  it("drops the body of GET requests", async () => {
    const request = toRequest(event({ method: "GET", body: "ignored" }));
    expect(await request.text()).toBe("");
  });

  it("buffers the response and splits Set-Cookie", async () => {
    const headers = new Headers({ "content-type": "text/plain" });
    headers.append("set-cookie", "a=1");
    const result = await toResult(new Response("ok", { status: 201, headers }));

    expect(result).toEqual({
      statusCode: 201,
      headers: { "content-type": "text/plain" },
      body: "ok",
      isBase64Encoded: false,
      cookies: ["a=1"],
    });
  });
});

describe("createLambdaHandler", () => {
  const handler = createLambdaHandler({
    env,
    client: new DofClient({ fetch: sidofFetch, retries: 0 }),
  });

  it("serves MCP requests that carry the origin secret", async () => {
    const result = await handler(event({ body: initialize }));

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('"name":"dof-mcp"');
  });

  it.each([
    ["no secret", { [ORIGIN_SECRET_HEADER]: undefined }],
    ["a wrong secret", { [ORIGIN_SECRET_HEADER]: "x".repeat(40) }],
  ])("refuses requests with %s", async (_label, headers) => {
    const result = await handler(
      event({ body: initialize, headers: { ...event().headers, ...headers } }),
    );

    expect(result.statusCode).toBe(403);
  });

  it("refuses hosts other than the configured ones", async () => {
    const result = await handler(
      event({
        body: initialize,
        headers: { ...event().headers, host: "abc.execute-api.mx-central-1.amazonaws.com" },
      }),
    );

    expect(result.statusCode).toBe(403);
  });

  it("answers the health probe without the secret", async () => {
    const result = await handler(
      event({ method: "GET", rawPath: "/healthz", headers: { host: HOST } }),
    );

    expect(result.statusCode).toBe(200);
  });

  it("rejects bodies over 64 KiB", async () => {
    const result = await handler(event({ body: `${initialize}${" ".repeat(70_000)}` }));

    expect(result.statusCode).toBe(413);
  });
});

describe("citeNote", () => {
  it("follows the SIDOF legal notice format", () => {
    expect(
      citeNote(
        {
          title: "Acuerdo de prueba.",
          date: "2026-10-16",
          branch: "PODER EJECUTIVO",
          organizations: ["SECRETARIA DE GOBERNACION"],
          officialUrl: "https://dof.gob.mx/nota_detalle.php?codigo=1&fecha=16/10/2026",
        },
        new Date("2026-10-18T02:00:00Z"),
      ),
    ).toBe(
      "Acuerdo de prueba, SECRETARIA DE GOBERNACION; Estados Unidos Mexicanos; DOF 16/10/2026; " +
        "[citado el 17 de octubre de 2026]; disponible en versión HTML en internet: " +
        "https://dof.gob.mx/nota_detalle.php?codigo=1&fecha=16/10/2026",
    );
  });

  it("trims trailing periods quickly, even with long runs of dots mid-title", () => {
    const note = {
      title: `${".".repeat(200_000)}x...`,
      date: "2026-10-16",
      branch: "B",
      organizations: [],
      officialUrl: "u",
    };
    const started = performance.now();
    const citation = citeNote(note, new Date("2026-10-18T02:00:00Z"));

    expect(performance.now() - started).toBeLessThan(500);
    expect(citation.startsWith(`${".".repeat(200_000)}x, B;`)).toBe(true);
  });

  it("falls back to the branch without an issuing body", () => {
    expect(
      citeNote(
        {
          title: "T",
          date: "2026-01-05",
          branch: "PODER JUDICIAL",
          organizations: [],
          officialUrl: "u",
        },
        new Date("2026-01-06T18:00:00Z"),
      ),
    ).toMatch(/^T, PODER JUDICIAL; .*DOF 05\/01\/2026; \[citado el 6 de enero de 2026\]/);
  });
});
