import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DofApiError,
  DofClient,
  htmlToText,
  normalizeIndicator,
  normalizeNoteDetail,
  officialNoteUrl,
} from "../src/index.js";
import { rawNoteDetailResponseSchema } from "../src/schema.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8"));
}

const noteFixture = fixture("nota-5801457.json");

describe("htmlToText", () => {
  it("drops head and styles, keeps line breaks and table cells", () => {
    const html =
      "<html><head><title>T</title><style>.a{}</style></head><body>" +
      "<div>Primero&nbsp;y <b>segundo</b></div><br><table><tr><td>A</td><td>B</td></tr></table>" +
      "<p>&#225;rbol &amp; &#x00F1;</p></body></html>";

    expect(htmlToText(html)).toBe("Primero y segundo\n\nA | B\n\nárbol & ñ");
  });

  it("keeps a stray less-than sign in the text", () => {
    expect(htmlToText("<p>si x < 5 y z > 3</p>")).toBe("si x < 5 y z > 3");
  });

  it("leaves unknown entities untouched", () => {
    expect(htmlToText("<p>&bogus; &#xZZ;</p>")).toBe("&bogus; &#xZZ;");
  });
});

describe("normalizeNoteDetail", () => {
  const raw = rawNoteDetailResponseSchema.parse(noteFixture);
  const note = normalizeNoteDetail(raw);

  it("maps metadata from the recorded note", () => {
    expect(note).toMatchObject({
      id: 5801457,
      date: "2026-10-16",
      edition: "vespertina",
      branch: "PODER EJECUTIVO",
      hasPdf: true,
      contentTooLarge: false,
      officialUrl: "https://dof.gob.mx/nota_detalle.php?codigo=5801457&fecha=16/10/2026",
    });
  });

  it('treats SIDOF\'s "null" strings as missing organizations', () => {
    expect(note.organizations).toEqual(["SECRETARIA DE HACIENDA Y CREDITO PUBLICO"]);
  });

  it("converts the HTML content to plain text", () => {
    expect(note.text.length).toBeGreaterThan(1000);
    expect(note.text).not.toMatch(/<\/?(div|span|td)/i);
    expect(note.text).toMatch(/Gilberto Sosa Sánchez/);
  });
});

describe("normalizeIndicator", () => {
  it("parses decimal strings, stripping the percent sign", () => {
    expect(
      normalizeIndicator({
        codIndicador: 1,
        codTipoIndicador: 165,
        fecha: "16-10-2026",
        valor: "6.7659%",
      }),
    ).toEqual({
      code: 165,
      key: "tiie28",
      name: "TIIE a 28 días",
      unit: "%",
      date: "2026-10-16",
      value: 6.7659,
    });
  });

  it("keeps unknown indicator codes without a key", () => {
    const indicator = normalizeIndicator({
      codIndicador: 1,
      codTipoIndicador: 999,
      fecha: "16-10-2026",
      valor: "1.5",
    });

    expect(indicator.key).toBeUndefined();
    expect(indicator.name).toBe("Indicador 999");
  });

  it("fails loudly on a non-numeric value", () => {
    expect(() =>
      normalizeIndicator({
        codIndicador: 1,
        codTipoIndicador: 158,
        fecha: "16-10-2026",
        valor: "",
      }),
    ).toThrow(DofApiError);
  });
});

describe("officialNoteUrl", () => {
  it("uses the slash date format dof.gob.mx expects", () => {
    expect(officialNoteUrl(42, "05-01-2026")).toBe(
      "https://dof.gob.mx/nota_detalle.php?codigo=42&fecha=05/01/2026",
    );
  });
});

describe("DofClient detail endpoints", () => {
  function clientFor(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(body));
    return { fetchMock, client: new DofClient({ fetch: fetchMock }) };
  }

  it("requests the note-detail endpoint", async () => {
    const { client, fetchMock } = clientFor(noteFixture);

    await client.getNote(5801457);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://sidof.segob.gob.mx/dof/sidof/notas/nota/5801457",
    );
  });

  it("rejects invalid note ids without calling SIDOF", async () => {
    const { client, fetchMock } = clientFor(noteFixture);

    await expect(client.getNote(-1)).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests the latest indicators when no date is given", async () => {
    const { client, fetchMock } = clientFor(fixture("indicadores-16-10-2026.json"));

    const indicators = await client.getIndicators();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://sidof.segob.gob.mx/dof/sidof/indicadores/");
    expect(indicators.map((i) => i.key)).toEqual([
      "fix",
      "udis",
      "tiie28",
      "tiie91",
      "tiie182",
      "tiieFondeo",
    ]);
  });

  it("requests an indicator series by code and date range", async () => {
    const { client, fetchMock } = clientFor(fixture("indicadores-158-01-10-2026-16-10-2026.json"));

    const series = await client.getIndicatorSeries("fix", "2026-10-01", "2026-10-16");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://sidof.segob.gob.mx/dof/sidof/indicadores/158/01-10-2026/16-10-2026",
    );
    expect(series[0]).toMatchObject({ key: "fix", date: "2026-10-01", value: 18.0692 });
  });

  it("checks messageCode before the endpoint shape", async () => {
    const { client } = clientFor({ messageCode: 404, response: "NO ENCONTRADO" });

    await expect(client.getNote(1)).rejects.toThrow(/messageCode 404/);
  });
});
