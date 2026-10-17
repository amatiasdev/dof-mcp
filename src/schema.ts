import { z } from "zod";

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

export const rawDailyResponseSchema = z.object({
  messageCode: z.number().int(),
  response: z.string(),
  NotasMatutinas: z.array(rawNoteSchema).default([]),
  NotasVespertinas: z.array(rawNoteSchema).default([]),
  NotasExtraordinarias: z.array(rawNoteSchema).default([]),
});

export type RawNote = z.infer<typeof rawNoteSchema>;
export type RawDailyResponse = z.infer<typeof rawDailyResponseSchema>;

export type Edition = "matutina" | "vespertina" | "extraordinaria";

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
}
