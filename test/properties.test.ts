// Property-based tests: fast-check generates thousands of inputs per run, a lightweight fuzzer for
// the code that handles untrusted data (SIDOF HTML and payloads, client requests).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  citeNote,
  HtmlTooDeepError,
  htmlToText,
  normalizeIndicator,
  toSidofDate,
} from "../src/index.js";
import { describeRequest, describeResponse } from "../src/lambda.js";

const runs = { numRuns: 500 };

/** Strings biased toward HTML-ish content: tags, entities, brackets, whitespace. */
const htmlish = fc.stringMatching(/^[<>/a-z!&#;0-9 \n.|-]{0,400}$/);

describe("htmlToText properties", () => {
  it("never throws except for deliberately deep nesting", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 400 }), htmlish), (html) => {
        try {
          htmlToText(html);
        } catch (error) {
          expect(error).toBeInstanceOf(HtmlTooDeepError);
        }
      }),
      runs,
    );
  });

  it("returns trimmed text without blank-line runs", () => {
    fc.assert(
      fc.property(htmlish, (html) => {
        const text = htmlToText(html);
        expect(text).toBe(text.trim());
        expect(text).not.toMatch(/\n\s*\n\s*\n/);
      }),
      runs,
    );
  });

  it("keeps plain text without markup or entities as is, modulo whitespace", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9áéíóúñ.,;:()]{1,60}( [A-Za-z0-9áéíóúñ.,;:()]{1,60}){0,5}$/),
        (text) => {
          expect(htmlToText(`<p>${text}</p>`)).toBe(text);
        },
      ),
      runs,
    );
  });
});

describe("toSidofDate properties", () => {
  it("round-trips every real calendar date", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("1917-01-01T00:00:00Z"),
          max: new Date("2099-12-31T00:00:00Z"),
          noInvalidDate: true,
        }),
        (date) => {
          const iso = date.toISOString().slice(0, 10);
          const [y, m, d] = iso.split("-");
          expect(toSidofDate(iso)).toBe(`${d}-${m}-${y}`);
        },
      ),
      runs,
    );
  });

  it("rejects anything that is not YYYY-MM-DD with a RangeError, never another error", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (input) => {
        try {
          toSidofDate(input);
          expect(input).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        } catch (error) {
          expect(error).toBeInstanceOf(RangeError);
        }
      }),
      runs,
    );
  });
});

describe("normalizeIndicator properties", () => {
  it("parses decimals exactly and fails loudly on anything else", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 15 }), (valor) => {
        const raw = { codIndicador: 1, codTipoIndicador: 158, fecha: "16-10-2026", valor };
        const digits = valor.trim().replace(/%$/, "");
        if (/^-?\d+(\.\d+)?$/.test(digits)) {
          expect(normalizeIndicator(raw).value).toBe(Number(digits));
        } else {
          expect(() => normalizeIndicator(raw)).toThrow(/Unexpected indicator value/);
        }
      }),
      runs,
    );
  });
});

describe("citeNote properties", () => {
  it("never ends the title part with a period before the authority", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (title) => {
        const citation = citeNote(
          { title, date: "2026-10-16", branch: "B", organizations: [], officialUrl: "u" },
          new Date("2026-10-18T02:00:00Z"),
        );
        expect(citation).not.toMatch(/\., B;/);
      }),
      runs,
    );
  });
});

describe("usage metric extraction properties", () => {
  const anyJson = fc.jsonValue({ maxDepth: 4 });

  it("never throws, whatever the body", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          anyJson.map((v) => JSON.stringify(v)),
        ),
        (body) => {
          describeRequest({ body, isBase64Encoded: false });
          describeResponse(body);
        },
      ),
      runs,
    );
  });

  it("never copies tool arguments into the summary", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 8, maxLength: 30 }), anyJson, (marker, extra) => {
        const secret = `ARG-${marker}`;
        const body = JSON.stringify({
          method: "tools/call",
          params: { name: "dof_get_note", arguments: { id: secret, extra } },
        });
        expect(JSON.stringify(describeRequest({ body, isBase64Encoded: false }))).not.toContain(
          secret,
        );
      }),
      runs,
    );
  });

  it("only emits short, printable labels", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (name, version) => {
        const body = JSON.stringify({
          method: "initialize",
          params: { clientInfo: { name, version } },
        });
        for (const value of Object.values(describeRequest({ body, isBase64Encoded: false }))) {
          expect(value.length).toBeLessThanOrEqual(64);
          expect(value).toMatch(/^[\w .@/+-]+$/);
        }
      }),
      runs,
    );
  });
});
