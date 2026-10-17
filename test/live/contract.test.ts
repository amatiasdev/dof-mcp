import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, DofClient, type Note, todayInMexico } from "../../src/index.js";

// A few requests per run, spaced out by the client's concurrency limit of 1.
const client = new DofClient({ maxConcurrency: 1, retries: 2 });

function fixtureKeys(name: string, pick: (json: Record<string, unknown>) => unknown): string[] {
  const json = JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8"));
  return Object.keys(pick(json) as Record<string, unknown>).sort();
}

async function rawJson(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${DEFAULT_BASE_URL}${path}`, {
    headers: { Accept: "application/json, */*;q=0.8" },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

/** Fields SIDOF added since the fixture was recorded; worth a look, but not a failure. */
function reportNewFields(label: string, live: object, recorded: string[]): void {
  const added = Object.keys(live).filter((k) => !recorded.includes(k));
  if (added.length > 0) console.warn(`${label}: new fields since the fixture: ${added.join(", ")}`);
}

function isoDaysAgo(days: number): string {
  const today = new Date(`${todayInMexico()}T12:00:00Z`);
  today.setUTCDate(today.getUTCDate() - days);
  return today.toISOString().slice(0, 10);
}

let day: string;
let notes: Note[];

beforeAll(async () => {
  // Weekends and holidays have no issue; walk back to the most recent day with publications.
  for (let back = 1; back <= 10; back++) {
    day = isoDaysAgo(back);
    notes = await client.getNotes(day);
    if (notes.length > 0) return;
  }
  throw new Error("No DOF publications found in the last 10 days");
});

describe("SIDOF contract", () => {
  it("daily notes still parse and normalize", async () => {
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.title.length > 0 && n.date === day)).toBe(true);

    const raw = await rawJson(`/notas/${day.split("-").reverse().join("-")}`);
    reportNewFields(
      "notas",
      raw,
      fixtureKeys("notas-16-10-2026.json", (j) => j),
    );
  });

  it("note detail still parses and has content", async () => {
    const id = notes[0]?.id;
    if (id === undefined) throw new Error("no note id");

    const note = await client.getNote(id);
    expect(note.id).toBe(id);
    expect(note.text.length).toBeGreaterThan(0);

    const raw = await rawJson(`/notas/nota/${id}`);
    reportNewFields(
      "notas/nota",
      raw.Nota as object,
      fixtureKeys("nota-5801457.json", (j) => j.Nota),
    );
  });

  it("indicator series still parses with known codes", async () => {
    const series = await client.getIndicatorSeries("fix", isoDaysAgo(20), isoDaysAgo(1));

    expect(series.length).toBeGreaterThan(0);
    expect(series.every((i) => i.key === "fix" && i.value > 0)).toBe(true);
  });

  it("indicators for a publication day include FIX and UDIS", async () => {
    const indicators = await client.getIndicators(day);
    const keys = indicators.map((i) => i.key);

    expect(keys).toContain("fix");
    expect(keys).toContain("udis");
  });
});
