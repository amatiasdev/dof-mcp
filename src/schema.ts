import { z } from "zod";

/** Every SIDOF payload carries this envelope; `messageCode` is 200 on success. */
export const rawEnvelopeSchema = z.object({
  messageCode: z.number().int(),
  response: z.string(),
});

/** Some SIDOF endpoints write absent values as the string "null"; treat those as missing. */
const sidofText = z
  .string()
  .nullish()
  .transform((value) =>
    value === null || value === undefined || value === "null" || value.trim() === ""
      ? undefined
      : value,
  );

/** Raw note as returned by the SIDOF `notas/{DD-MM-YYYY}` endpoint. */
export const rawNoteSchema = z.object({
  codNota: z.number().int(),
  titulo: z.string().optional(),
  codSeccion: z.string(),
  fecha: z.string(),
  codDiario: z.number().int(),
  existeHtml: z.string(),
  existeDoc: z.string(),
  existeImagen: z.string(),
  existePdf: z.string(),
  tipoNota: z.string(),
  estado: z.number().int(),
  pagina: z.number().int(),
  paginaHasta: z.number().int(),
  nombreCodOrgaUno: z.string(),
  codOrgaUno: z.string(),
  codOrgaDos: z.string().optional(),
  orden: z.number(),
});

export const rawDailyResponseSchema = rawEnvelopeSchema.extend({
  NotasMatutinas: z.array(rawNoteSchema).default([]),
  NotasVespertinas: z.array(rawNoteSchema).default([]),
  NotasExtraordinarias: z.array(rawNoteSchema).default([]),
});

/** Raw note as returned by the SIDOF `notas/nota/{codNota}` endpoint. */
export const rawNoteDetailSchema = z.object({
  codNota: z.number().int(),
  titulo: z.string(),
  codSeccion: z.string(),
  fecha: z.string(),
  codDiario: z.number().int(),
  cadenaContenido: sidofText,
  existeDoc: z.string(),
  existePdf: z.string(),
  pagina: z.number().int(),
  codOrgaUno: z.string(),
  codOrgaDos: sidofText,
  codOrgaTres: sidofText,
  codOrgaCuatro: sidofText,
  codEdicion: sidofText,
});

export const rawNoteDetailResponseSchema = rawEnvelopeSchema.extend({
  tamanioExcesivo: z.boolean().optional(),
  Nota: rawNoteDetailSchema,
});

/** The note-detail endpoint answers an unknown id with 200 and `"Nota": []`. */
export const rawNoteLookupResponseSchema = rawEnvelopeSchema.extend({
  tamanioExcesivo: z.boolean().optional(),
  Nota: z.union([rawNoteDetailSchema, z.array(z.unknown()).length(0)]),
});

/** Raw indicator as returned by the SIDOF `indicadores/...` endpoints. */
export const rawIndicatorSchema = z.object({
  codIndicador: z.number().int(),
  codTipoIndicador: z.number().int(),
  fecha: z.string(),
  /** Decimal string, sometimes with a trailing "%". */
  valor: z.string(),
});

export const rawIndicatorsResponseSchema = rawEnvelopeSchema.extend({
  ListaIndicadores: z.array(rawIndicatorSchema).default([]),
});

export type RawNote = z.infer<typeof rawNoteSchema>;
export type RawDailyResponse = z.infer<typeof rawDailyResponseSchema>;
export type RawNoteDetailResponse = z.infer<typeof rawNoteDetailResponseSchema>;
export type RawIndicator = z.infer<typeof rawIndicatorSchema>;
export type RawIndicatorsResponse = z.infer<typeof rawIndicatorsResponseSchema>;

export const EDITIONS = ["matutina", "vespertina", "extraordinaria"] as const;
export type Edition = (typeof EDITIONS)[number];

/** Normalized publication. Rows without a title (section headers) are dropped. */
export interface Note {
  id: number;
  title: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  edition: Edition;
  section: string;
  page: number;
  /** Top-level branch, e.g. "PODER EJECUTIVO". */
  branch: string;
  /** Issuing body, e.g. "SECRETARIA DE HACIENDA Y CREDITO PUBLICO", when present. */
  organization?: string;
  hasPdf: boolean;
  hasHtml: boolean;
  /** Link to the publication on dof.gob.mx, for humans. Do not fetch it from code (robots.txt). */
  officialUrl: string;
}

/** Normalized note detail with its content as plain text. */
export interface NoteDetail {
  id: number;
  title: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Present when SIDOF reports a known edition code. */
  edition?: Edition;
  section: string;
  page: number;
  branch: string;
  /** Issuing bodies from the most general to the most specific, when present. */
  organizations: string[];
  hasPdf: boolean;
  hasDoc: boolean;
  /** Plain-text content converted from SIDOF's HTML. Empty when SIDOF returns no content. */
  text: string;
  /** SIDOF flags notes whose content is too large to return inline. */
  contentTooLarge: boolean;
  officialUrl: string;
}

/** Indicators SIDOF publishes, keyed by their `codTipoIndicador`. */
export const INDICATORS = {
  fix: { code: 158, name: "Tipo de cambio FIX (pesos por dólar)", unit: "MXN/USD" },
  udis: { code: 159, name: "Valor de la UDI", unit: "MXN" },
  tiie28: { code: 165, name: "TIIE a 28 días", unit: "%" },
  tiie91: { code: 166, name: "TIIE a 91 días", unit: "%" },
  tiie182: { code: 174, name: "TIIE a 182 días", unit: "%" },
  tiieFondeo: { code: 175, name: "TIIE de fondeo", unit: "%" },
} as const;

export type IndicatorKey = keyof typeof INDICATORS;

export interface Indicator {
  /** SIDOF `codTipoIndicador`. */
  code: number;
  /** Known key, absent for codes this library does not recognize yet. */
  key?: IndicatorKey;
  name: string;
  unit?: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  value: number;
}
