import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DofApiError, DofClient, DofQueueFullError, toSidofDate, VERSION } from "../src/index.js";

const fixtureText = readFileSync(
  new URL("./fixtures/notas-16-10-2026.json", import.meta.url),
  "utf-8",
);

function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json;charset=UTF-8", ...headers },
  });
}

/** A fetch mock that returns a fresh Response per call (bodies can only be read once). */
function fetchReturning(...responses: (() => Response)[]) {
  const fallback = responses.at(-1);
  let call = 0;
  return vi.fn(async () => {
    const next = responses[call++] ?? fallback;
    if (!next) throw new Error("no response configured");
    return next();
  });
}

const ok = () => textResponse(fixtureText);

describe("toSidofDate validation", () => {
  it.each(["2026-02-30", "2026-13-01", "2026-00-10", "2025-02-29"])("rejects %s", (date) => {
    expect(() => toSidofDate(date)).toThrow(RangeError);
  });

  it("accepts leap days", () => {
    expect(toSidofDate("2028-02-29")).toBe("29-02-2028");
  });

  it("rejects an invalid Date", () => {
    expect(() => toSidofDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("DofClient hardening", () => {
  it("sends an identifying User-Agent", async () => {
    const fetchMock = fetchReturning(ok);
    await new DofClient({ fetch: fetchMock }).getNotes("2026-10-16");

    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init[1].headers as Record<string, string>)["User-Agent"]).toBe(
      `dof-mcp/${VERSION} (+https://github.com/amatiasdev/dof-mcp)`,
    );
  });

  it("rejects non-http base URLs", () => {
    expect(() => new DofClient({ baseUrl: "file:///etc/passwd" })).toThrow(RangeError);
  });

  it("retries 429 responses", async () => {
    const fetchMock = fetchReturning(() => textResponse("{}", 429), ok);
    const client = new DofClient({ fetch: fetchMock, retries: 1, retryBaseDelayMs: 0 });

    await expect(client.getNotes("2026-10-16")).resolves.not.toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits for a short Retry-After before retrying", async () => {
    const fetchMock = fetchReturning(() => textResponse("{}", 503, { "Retry-After": "1" }), ok);
    const client = new DofClient({ fetch: fetchMock, retries: 1, retryBaseDelayMs: 0 });

    const started = Date.now();
    await client.getNotes("2026-10-16");

    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  });

  it("fails fast when Retry-After asks for too long a wait", async () => {
    const fetchMock = fetchReturning(() => textResponse("{}", 503, { "Retry-After": "3600" }));
    const client = new DofClient({ fetch: fetchMock, retries: 3, retryBaseDelayMs: 0 });

    await expect(client.getNotes("2026-10-16")).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured retries", async () => {
    const fetchMock = fetchReturning(() => textResponse("{}", 500));
    const client = new DofClient({ fetch: fetchMock, retries: 2, retryBaseDelayMs: 0 });

    await expect(client.getNotes("2026-10-16")).rejects.toBeInstanceOf(DofApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects responses over the size limit, by header or by body", async () => {
    const declared = new DofClient({
      fetch: fetchReturning(() => textResponse(fixtureText, 200, { "Content-Length": "999999" })),
      maxResponseBytes: 1000,
    });
    await expect(declared.getNotes("2026-10-16")).rejects.toThrow(/larger than 1000 bytes/);

    const streamed = new DofClient({ fetch: fetchReturning(ok), maxResponseBytes: 1000 });
    await expect(streamed.getNotes("2026-10-16")).rejects.toThrow(/larger than 1000 bytes/);
  });

  it("does not retry a body that is not JSON", async () => {
    const fetchMock = fetchReturning(() => textResponse("<html>mantenimiento</html>"));
    const client = new DofClient({ fetch: fetchMock, retries: 2, retryBaseDelayMs: 0 });

    await expect(client.getNotes("2026-10-16")).rejects.toThrow(/not valid JSON/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports provenance with a SHA-256 of the raw body", async () => {
    const client = new DofClient({ fetch: fetchReturning(ok) });

    const { data, source } = await client.getNotesWithSource("2026-10-16");

    expect(data.length).toBeGreaterThan(0);
    expect(source.sourceUrl).toBe("https://sidof.segob.gob.mx/dof/sidof/notas/16-10-2026");
    expect(source.sha256).toBe(createHash("sha256").update(fixtureText).digest("hex"));
    expect(Date.parse(source.fetchedAt)).not.toBeNaN();
  });
});

describe("DofClient validation errors", () => {
  it("summarizes schema errors instead of serializing every issue", async () => {
    const notes = Array.from({ length: 1000 }, () => ({}));
    const body = JSON.stringify({ messageCode: 200, response: "OK", NotasMatutinas: notes });
    const client = new DofClient({ fetch: fetchReturning(() => textResponse(body)) });

    const error = await client.getNotes("2026-10-16").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DofApiError);
    expect((error as Error).message.length).toBeLessThan(600);
    expect((error as Error).message).toMatch(/NotasMatutinas\.0\.codNota: invalid_type/);
    expect((error as Error).message).toMatch(/and \d+ more issues/);
  });

  it("rejects malformed dates from SIDOF before they reach official URLs", async () => {
    const raw = JSON.parse(fixtureText);
    raw.NotasMatutinas[0].fecha = "01-01-2026&x=<script>";
    const client = new DofClient({
      fetch: fetchReturning(() => textResponse(JSON.stringify(raw))),
    });

    await expect(client.getNotes("2026-10-16")).rejects.toThrow(/fecha: invalid_format/);
  });
});

describe("DofClient cache", () => {
  it("reuses a cached response, keeping the original provenance", async () => {
    const fetchMock = fetchReturning(ok);
    const client = new DofClient({ fetch: fetchMock });

    const first = await client.getNotesWithSource("2026-10-16");
    const second = await client.getNotesWithSource("2026-10-16");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.source).toEqual(first.source);
  });

  it("shares one request between concurrent callers", async () => {
    const fetchMock = fetchReturning(ok);
    const client = new DofClient({ fetch: fetchMock });

    await Promise.all([client.getNotes("2026-10-16"), client.getNotes("2026-10-16")]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const fetchMock = fetchReturning(() => textResponse("{}", 404), ok);
    const client = new DofClient({ fetch: fetchMock });

    await expect(client.getNotes("2026-10-16")).rejects.toThrow(/404/);
    await expect(client.getNotes("2026-10-16")).resolves.not.toHaveLength(0);
  });

  it("expires entries after the TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const fetchMock = fetchReturning(ok);
      const client = new DofClient({ fetch: fetchMock, cacheTtlMs: 1000 });

      await client.getNotes("2026-10-16");
      vi.setSystemTime(Date.now() + 1001);
      await client.getNotes("2026-10-16");

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the least recently used entry", async () => {
    const fetchMock = fetchReturning(ok);
    const client = new DofClient({ fetch: fetchMock, cacheMaxEntries: 1 });

    await client.getDailyRaw("2026-10-16");
    await client.getDailyRaw("2026-10-15");
    await client.getDailyRaw("2026-10-16");

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not cache responses over maxCacheableBytes", async () => {
    const fetchMock = fetchReturning(ok);
    const client = new DofClient({ fetch: fetchMock, maxCacheableBytes: 1000 });

    const { source } = await client.getNotesWithSource("2026-10-16");
    await client.getNotes("2026-10-16");

    expect(source.bytes).toBe(Buffer.byteLength(fixtureText));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("can be disabled", async () => {
    const fetchMock = fetchReturning(ok);
    const client = new DofClient({ fetch: fetchMock, cacheTtlMs: 0 });

    await client.getNotes("2026-10-16");
    await client.getNotes("2026-10-16");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("DofClient concurrency", () => {
  it("keeps at most maxConcurrency requests in flight", async () => {
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return ok();
    });
    const client = new DofClient({ fetch: fetchMock, maxConcurrency: 2 });

    await Promise.all(
      ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"].map((d) =>
        client.getDailyRaw(d),
      ),
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });

  it("fails fast, without retrying, when the queue is full", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return ok();
    });
    const client = new DofClient({
      fetch: fetchMock,
      maxConcurrency: 1,
      maxQueue: 1,
      cacheTtlMs: 0,
      retryBaseDelayMs: 0,
    });

    const running = client.getDailyRaw("2026-10-14");
    const queued = client.getDailyRaw("2026-10-15");
    await expect(client.getDailyRaw("2026-10-16")).rejects.toBeInstanceOf(DofQueueFullError);

    release();
    await Promise.all([running, queued]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not hold a slot while waiting to retry", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      calls++;
      return url.endsWith("15-10-2026") && calls === 1
        ? textResponse("{}", 503, { "Retry-After": "1" })
        : ok();
    });
    const client = new DofClient({
      fetch: fetchMock as unknown as typeof fetch,
      maxConcurrency: 1,
      retryBaseDelayMs: 0,
    });

    const retrying = client.getDailyRaw("2026-10-15");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = Date.now();
    await client.getDailyRaw("2026-10-16");

    expect(Date.now() - started).toBeLessThan(500);
    await retrying;
  });
});
