import type { z } from "zod";
import { htmlToText } from "./html.js";
import {
  type Edition,
  INDICATORS,
  type Indicator,
  type IndicatorKey,
  type Note,
  type NoteDetail,
  type RawDailyResponse,
  type RawIndicator,
  type RawNote,
  type RawNoteDetailResponse,
  rawDailyResponseSchema,
  rawEnvelopeSchema,
  rawIndicatorsResponseSchema,
  rawNoteDetailResponseSchema,
} from "./schema.js";

export const DEFAULT_BASE_URL = "https://sidof.segob.gob.mx/dof/sidof";

/** Public note page on dof.gob.mx. Only for humans: robots.txt disallows fetching it. */
const OFFICIAL_NOTE_URL = "https://dof.gob.mx/nota_detalle.php";

// SIDOF answers 406 to a bare "application/json" (it serves "application/json;charset=UTF-8"),
// so the header has to allow a fallback.
const ACCEPT_HEADER = "application/json, */*;q=0.8";

const EDITION_CODES: Record<string, Edition> = { MAT: "matutina", VES: "vespertina" };

export interface DofClientOptions {
  baseUrl?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Retries for network errors and 5xx responses. */
  retries?: number;
  fetch?: typeof globalThis.fetch;
}

export class DofApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DofApiError";
  }
}

/** Formats a date as the DD-MM-YYYY path segment SIDOF expects. Accepts a Date or YYYY-MM-DD. */
export function toSidofDate(date: Date | string): string {
  if (typeof date === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) throw new RangeError(`Expected YYYY-MM-DD, got "${date}"`);
    const [, y, m, d] = match;
    return `${d}-${m}-${y}`;
  }
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${d}-${m}-${date.getFullYear()}`;
}

function toIsoDate(sidofDate: string): string {
  const [d, m, y] = sidofDate.split("-");
  return `${y}-${m}-${d}`;
}

/** Builds the human-facing dof.gob.mx link for a note. */
export function officialNoteUrl(id: number, sidofDate: string): string {
  return `${OFFICIAL_NOTE_URL}?codigo=${id}&fecha=${sidofDate.replaceAll("-", "/")}`;
}

function normalize(raw: RawNote, edition: Edition): Note | undefined {
  if (!raw.titulo) return undefined;
  return {
    id: raw.codNota,
    title: raw.titulo.trim(),
    date: toIsoDate(raw.fecha),
    edition,
    section: raw.codSeccion,
    page: raw.pagina,
    branch: raw.nombreCodOrgaUno,
    ...(raw.codOrgaDos ? { organization: raw.codOrgaDos } : {}),
    hasPdf: raw.existePdf === "S",
    hasHtml: raw.existeHtml === "S",
    officialUrl: officialNoteUrl(raw.codNota, raw.fecha),
  };
}

/** Flattens a daily response into normalized notes, in edition order. */
export function normalizeDaily(response: RawDailyResponse): Note[] {
  const editions: [Edition, RawNote[]][] = [
    ["matutina", response.NotasMatutinas],
    ["vespertina", response.NotasVespertinas],
    ["extraordinaria", response.NotasExtraordinarias],
  ];
  return editions.flatMap(([edition, notes]) =>
    notes.map((n) => normalize(n, edition)).filter((n): n is Note => n !== undefined),
  );
}

/** Converts a note-detail response into a {@link NoteDetail} with plain-text content. */
export function normalizeNoteDetail(response: RawNoteDetailResponse): NoteDetail {
  const raw = response.Nota;
  const edition = raw.codEdicion ? EDITION_CODES[raw.codEdicion] : undefined;
  return {
    id: raw.codNota,
    title: raw.titulo.trim(),
    date: toIsoDate(raw.fecha),
    ...(edition ? { edition } : {}),
    section: raw.codSeccion,
    page: raw.pagina,
    branch: raw.codOrgaUno,
    organizations: [raw.codOrgaDos, raw.codOrgaTres, raw.codOrgaCuatro].filter(
      (o): o is string => o !== undefined,
    ),
    hasPdf: raw.existePdf === "S",
    hasDoc: raw.existeDoc === "S",
    text: raw.cadenaContenido ? htmlToText(raw.cadenaContenido) : "",
    contentTooLarge: response.tamanioExcesivo ?? false,
    officialUrl: officialNoteUrl(raw.codNota, raw.fecha),
  };
}

const INDICATORS_BY_CODE = new Map<number, { key: IndicatorKey; name: string; unit: string }>(
  Object.entries(INDICATORS).map(([key, info]) => [
    info.code,
    { key: key as IndicatorKey, name: info.name, unit: info.unit },
  ]),
);

/** Converts a raw indicator, parsing its decimal string value. */
export function normalizeIndicator(raw: RawIndicator): Indicator {
  // Number("") is 0, so check the format instead of trusting Number() alone.
  const digits = raw.valor.trim().replace(/%$/, "");
  const value = Number(digits);
  if (!/^-?\d+(\.\d+)?$/.test(digits) || !Number.isFinite(value)) {
    throw new DofApiError(`Unexpected indicator value "${raw.valor}" (code ${raw.codIndicador})`);
  }
  const known = INDICATORS_BY_CODE.get(raw.codTipoIndicador);
  return {
    code: raw.codTipoIndicador,
    ...(known
      ? { key: known.key, name: known.name, unit: known.unit }
      : { name: `Indicador ${raw.codTipoIndicador}` }),
    date: toIsoDate(raw.fecha),
    value,
  };
}

export class DofClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: DofClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retries = options.retries ?? 2;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** Returns every titled publication in the DOF for a given day. */
  async getNotes(date: Date | string): Promise<Note[]> {
    const raw = await this.getDailyRaw(date);
    return normalizeDaily(raw);
  }

  /** Returns the validated raw payload for a given day. */
  getDailyRaw(date: Date | string): Promise<RawDailyResponse> {
    return this.request(`/notas/${toSidofDate(date)}`, rawDailyResponseSchema);
  }

  /** Returns one publication with its full content as plain text. */
  async getNote(id: number): Promise<NoteDetail> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new RangeError(`Expected a positive integer note id, got ${id}`);
    }
    const raw = await this.request(`/notas/nota/${id}`, rawNoteDetailResponseSchema);
    return normalizeNoteDetail(raw);
  }

  /** Returns the indicators published for a day, or the latest ones when no date is given. */
  async getIndicators(date?: Date | string): Promise<Indicator[]> {
    const path = date === undefined ? "/indicadores/" : `/indicadores/${toSidofDate(date)}`;
    const raw = await this.request(path, rawIndicatorsResponseSchema);
    return raw.ListaIndicadores.map(normalizeIndicator);
  }

  /** Returns the daily values of one indicator between two dates, inclusive. */
  async getIndicatorSeries(
    indicator: IndicatorKey,
    from: Date | string,
    to: Date | string,
  ): Promise<Indicator[]> {
    const { code } = INDICATORS[indicator];
    const path = `/indicadores/${code}/${toSidofDate(from)}/${toSidofDate(to)}`;
    const raw = await this.request(path, rawIndicatorsResponseSchema);
    return raw.ListaIndicadores.map(normalizeIndicator);
  }

  private async request<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
    const body = await this.requestJson(`${this.baseUrl}${path}`);
    const envelope = rawEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw new DofApiError(`Unexpected SIDOF response shape: ${envelope.error.message}`);
    }
    if (envelope.data.messageCode !== 200) {
      throw new DofApiError(
        `SIDOF returned messageCode ${envelope.data.messageCode} (${envelope.data.response})`,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new DofApiError(`Unexpected SIDOF response shape: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  private async requestJson(url: string): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          headers: { Accept: ACCEPT_HEADER },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status >= 500) {
          lastError = new DofApiError(`SIDOF responded ${res.status}`, res.status);
          continue;
        }
        if (!res.ok) throw new DofApiError(`SIDOF responded ${res.status}`, res.status);
        return await res.json();
      } catch (error) {
        if (error instanceof DofApiError && error.status !== undefined && error.status < 500) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new DofApiError(`Request to ${url} failed after ${this.retries + 1} attempts`);
  }
}
