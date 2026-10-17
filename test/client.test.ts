import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DofApiError, DofClient, normalizeDaily, toSidofDate } from "../src/index.js";
import { rawDailyResponseSchema } from "../src/schema.js";

const fixture: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/notas-16-10-2026.json", import.meta.url), "utf-8"),
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("toSidofDate", () => {
  it("converts ISO strings to DD-MM-YYYY", () => {
    expect(toSidofDate("2026-10-16")).toBe("16-10-2026");
  });

  it("converts Date objects using local calendar fields", () => {
    expect(toSidofDate(new Date(2026, 0, 5))).toBe("05-01-2026");
  });

  it("rejects malformed strings", () => {
    expect(() => toSidofDate("16/10/2026")).toThrow(RangeError);
  });
});

describe("normalizeDaily", () => {
  const raw = rawDailyResponseSchema.parse(fixture);
  const notes = normalizeDaily(raw);

  it("keeps only titled publications", () => {
    const titled = [...raw.NotasMatutinas, ...raw.NotasVespertinas].filter((n) => n.titulo);
    expect(notes).toHaveLength(titled.length);
    expect(notes.every((n) => n.title.length > 0)).toBe(true);
  });

  it("tags editions and converts dates to ISO", () => {
    expect(new Set(notes.map((n) => n.edition))).toEqual(new Set(["matutina", "vespertina"]));
    expect(notes.every((n) => n.date === "2026-10-16")).toBe(true);
  });

  it("maps S/N flags to booleans", () => {
    expect(notes.every((n) => typeof n.hasPdf === "boolean")).toBe(true);
  });
});

describe("DofClient", () => {
  it("requests the dated endpoint and returns normalized notes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    const client = new DofClient({ fetch: fetchMock });

    const notes = await client.getNotes("2026-10-16");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sidof.segob.gob.mx/dof/sidof/notas/16-10-2026",
      expect.objectContaining({ headers: { Accept: "application/json, */*;q=0.8" } }),
    );
    expect(notes.length).toBeGreaterThan(0);
  });

  it("retries 5xx responses and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(fixture));
    const client = new DofClient({ fetch: fetchMock, retries: 1 });

    await expect(client.getNotes("2026-10-16")).resolves.not.toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry 4xx responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    const client = new DofClient({ fetch: fetchMock, retries: 2 });

    await expect(client.getNotes("2026-10-16")).rejects.toBeInstanceOf(DofApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects payloads with a non-200 messageCode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ messageCode: 500, response: "ERROR" }));
    const client = new DofClient({ fetch: fetchMock });

    await expect(client.getNotes("2026-10-16")).rejects.toThrow(/messageCode 500/);
  });

  it("rejects payloads with an unexpected shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ unexpected: true }));
    const client = new DofClient({ fetch: fetchMock });

    await expect(client.getNotes("2026-10-16")).rejects.toThrow(/Unexpected SIDOF response/);
  });
});
