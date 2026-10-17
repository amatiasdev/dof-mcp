import {
  type Edition,
  type Note,
  type RawDailyResponse,
  type RawNote,
  rawDailyResponseSchema,
} from "./schema.js";

export const DEFAULT_BASE_URL = "https://sidof.segob.gob.mx/dof/sidof";

// SIDOF answers 406 to a bare "application/json" (it serves "application/json;charset=UTF-8"),
// so the header has to allow a fallback.
const ACCEPT_HEADER = "application/json, */*;q=0.8";

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
  async getDailyRaw(date: Date | string): Promise<RawDailyResponse> {
    const url = `${this.baseUrl}/notas/${toSidofDate(date)}`;
    const body = await this.requestJson(url);
    const parsed = rawDailyResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new DofApiError(`Unexpected SIDOF response shape: ${parsed.error.message}`);
    }
    if (parsed.data.messageCode !== 200) {
      throw new DofApiError(
        `SIDOF returned messageCode ${parsed.data.messageCode} (${parsed.data.response})`,
      );
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
