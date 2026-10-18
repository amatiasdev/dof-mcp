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
  type RawIndicatorsResponse,
  type RawNote,
  type RawNoteDetailResponse,
  rawDailyResponseSchema,
  rawEnvelopeSchema,
  rawIndicatorsResponseSchema,
  rawNoteLookupResponseSchema,
} from "./schema.js";
import { VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://sidof.segob.gob.mx/dof/sidof";

/** Public note page on dof.gob.mx. Only for humans: robots.txt disallows fetching it. */
const OFFICIAL_NOTE_URL = "https://dof.gob.mx/nota_detalle.php";

// SIDOF answers 406 to a bare "application/json" (it serves "application/json;charset=UTF-8"),
// so the header has to allow a fallback.
const ACCEPT_HEADER = "application/json, */*;q=0.8";

const DEFAULT_USER_AGENT = `dof-mcp/${VERSION} (+https://github.com/amatiasdev/dof-mcp)`;

/** Longest Retry-After the client will honor; longer waits fail fast instead. */
const MAX_RETRY_AFTER_MS = 30_000;

const EDITION_CODES: Record<string, Edition> = { MAT: "matutina", VES: "vespertina" };

export interface DofClientOptions {
  baseUrl?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Retries for network errors, 429 and 5xx responses. */
  retries?: number;
  /** Base delay for exponential backoff with full jitter, in milliseconds. */
  retryBaseDelayMs?: number;
  /** Responses larger than this are rejected without being parsed. */
  maxResponseBytes?: number;
  /** How long successful responses are reused, in milliseconds. 0 disables the cache. */
  cacheTtlMs?: number;
  /** Maximum cached responses; the least recently used are evicted first. */
  cacheMaxEntries?: number;
  /** Responses larger than this are returned but not cached, to bound memory use. */
  maxCacheableBytes?: number;
  /** Maximum requests in flight to SIDOF at once. */
  maxConcurrency?: number;
  /** Maximum requests waiting for a slot; beyond it requests fail fast. */
  maxQueue?: number;
  userAgent?: string;
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

/** SIDOF has no such resource: an unknown note id, or a date with no published data. */
export class DofNotFoundError extends DofApiError {
  constructor(message: string) {
    super(message, 404);
    this.name = "DofNotFoundError";
  }
}

/** Where a result came from: the SIDOF URL, when it was fetched and a hash of the raw bytes. */
export interface Provenance {
  sourceUrl: string;
  /** ISO 8601 UTC timestamp of the fetch (cached results keep the original time). */
  fetchedAt: string;
  /** Hex SHA-256 of the raw response body. */
  sha256: string;
  /** Size of the raw response body in bytes. */
  bytes: number;
}

export interface Sourced<T> {
  data: T;
  source: Provenance;
}

/**
 * Formats a date as the DD-MM-YYYY path segment SIDOF expects. Accepts YYYY-MM-DD (preferred:
 * unambiguous) or a Date, which is read in the local time zone of the running process.
 */
export function toSidofDate(date: Date | string): string {
  if (typeof date === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) throw new RangeError(`Expected YYYY-MM-DD, got "${date}"`);
    const [, y, m, d] = match;
    const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (parsed.getUTCMonth() !== Number(m) - 1 || parsed.getUTCDate() !== Number(d)) {
      throw new RangeError(`"${date}" is not a real calendar date`);
    }
    return `${d}-${m}-${y}`;
  }
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid Date");
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

function normalizeIndicators(raw: RawIndicatorsResponse): Indicator[] {
  return raw.ListaIndicadores.map(normalizeIndicator);
}

/** A retryable HTTP failure that may carry the server's requested wait. */
class RetryAfterError extends DofApiError {
  constructor(
    message: string,
    status: number,
    readonly retryAfterMs: number | undefined,
  ) {
    super(message, status);
  }
}

function mapSourced<T, U>(sourced: Sourced<T>, map: (data: T) => U): Sourced<U> {
  return { data: map(sourced.data), source: sourced.source };
}

/** Milliseconds to wait from a Retry-After header (seconds or HTTP date), if present. */
function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  if (/^\d+$/.test(header.trim())) return Number(header.trim()) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads a response body, failing as soon as it exceeds `maxBytes`. */
async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new DofApiError(`SIDOF response is larger than ${maxBytes} bytes`, res.status);
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new DofApiError(`SIDOF response is larger than ${maxBytes} bytes`, res.status);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Raised when too many requests are already waiting; not retried. */
export class DofQueueFullError extends DofApiError {
  constructor(maxQueue: number) {
    super(`Too many pending SIDOF requests (more than ${maxQueue} waiting). Try again later.`);
    this.name = "DofQueueFullError";
  }
}

/** Caps how many tasks run at once; the rest wait in FIFO order, up to `maxQueue`. */
class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.queue.length >= this.maxQueue) throw new DofQueueFullError(this.maxQueue);
      // The finishing task hands its slot over, so `active` already counts this one.
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

interface CacheEntry {
  expires: number;
  value: Promise<Sourced<unknown>>;
}

export class DofClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxResponseBytes: number;
  private readonly cacheTtlMs: number;
  private readonly cacheMaxEntries: number;
  private readonly maxCacheableBytes: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly limiter: Limiter;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: DofClientOptions = {}) {
    const baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
      throw new RangeError(`baseUrl must be an http(s) URL, got "${baseUrl.href}"`);
    }
    this.baseUrl = baseUrl.href.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retries = options.retries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.maxResponseBytes = options.maxResponseBytes ?? 10 * 1024 * 1024;
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60_000;
    this.cacheMaxEntries = options.cacheMaxEntries ?? 256;
    this.maxCacheableBytes = options.maxCacheableBytes ?? 512 * 1024;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.limiter = new Limiter(
      Math.max(1, options.maxConcurrency ?? 4),
      Math.max(0, options.maxQueue ?? 64),
    );
  }

  /** Returns every titled publication in the DOF for a given day. */
  async getNotes(date: Date | string): Promise<Note[]> {
    return (await this.getNotesWithSource(date)).data;
  }

  /** Like {@link getNotes}, with the provenance of the SIDOF response. */
  async getNotesWithSource(date: Date | string): Promise<Sourced<Note[]>> {
    return mapSourced(await this.getDailyRawWithSource(date), normalizeDaily);
  }

  /** Returns the validated raw payload for a given day. */
  async getDailyRaw(date: Date | string): Promise<RawDailyResponse> {
    return (await this.getDailyRawWithSource(date)).data;
  }

  private getDailyRawWithSource(date: Date | string): Promise<Sourced<RawDailyResponse>> {
    return this.request(`/notas/${toSidofDate(date)}`, rawDailyResponseSchema);
  }

  /** Returns one publication with its full content as plain text. */
  async getNote(id: number): Promise<NoteDetail> {
    return (await this.getNoteWithSource(id)).data;
  }

  /** Like {@link getNote}, with the provenance of the SIDOF response. */
  async getNoteWithSource(id: number): Promise<Sourced<NoteDetail>> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new RangeError(`Expected a positive integer note id, got ${id}`);
    }
    const { data, source } = await this.request(`/notas/nota/${id}`, rawNoteLookupResponseSchema);
    const nota = data.Nota;
    if (Array.isArray(nota)) throw new DofNotFoundError(`Note ${id} does not exist in SIDOF`);
    return { data: normalizeNoteDetail({ ...data, Nota: nota }), source };
  }

  /** Returns the indicators SIDOF lists for a day, or for today when no date is given. */
  async getIndicators(date?: Date | string): Promise<Indicator[]> {
    return (await this.getIndicatorsWithSource(date)).data;
  }

  /** Like {@link getIndicators}, with the provenance of the SIDOF response. */
  async getIndicatorsWithSource(date?: Date | string): Promise<Sourced<Indicator[]>> {
    const path = date === undefined ? "/indicadores/" : `/indicadores/${toSidofDate(date)}`;
    const raw = await this.request(path, rawIndicatorsResponseSchema);
    return mapSourced(raw, normalizeIndicators);
  }

  /** Returns the daily values of one indicator between two dates, inclusive. */
  async getIndicatorSeries(
    indicator: IndicatorKey,
    from: Date | string,
    to: Date | string,
  ): Promise<Indicator[]> {
    return (await this.getIndicatorSeriesWithSource(indicator, from, to)).data;
  }

  /** Like {@link getIndicatorSeries}, with the provenance of the SIDOF response. */
  async getIndicatorSeriesWithSource(
    indicator: IndicatorKey,
    from: Date | string,
    to: Date | string,
  ): Promise<Sourced<Indicator[]>> {
    const { code } = INDICATORS[indicator];
    const path = `/indicadores/${code}/${toSidofDate(from)}/${toSidofDate(to)}`;
    const raw = await this.request(path, rawIndicatorsResponseSchema);
    return mapSourced(raw, normalizeIndicators);
  }

  /** Fetches and validates one SIDOF path, reusing a cached or in-flight result when possible. */
  private request<S extends z.ZodType>(path: string, schema: S): Promise<Sourced<z.output<S>>> {
    const url = `${this.baseUrl}${path}`;
    if (this.cacheTtlMs <= 0) return this.fetchValidated(url, schema);

    const now = Date.now();
    const hit = this.cache.get(url);
    if (hit && hit.expires > now) {
      // Re-insert to mark the entry as recently used.
      this.cache.delete(url);
      this.cache.set(url, hit);
      return hit.value as Promise<Sourced<z.output<S>>>;
    }

    const value = this.fetchValidated(url, schema);
    this.cache.set(url, { expires: now + this.cacheTtlMs, value });
    const evict = () => {
      if (this.cache.get(url)?.value === value) this.cache.delete(url);
    };
    value.then((result) => {
      if (result.source.bytes > this.maxCacheableBytes) evict();
    }, evict);
    while (this.cache.size > this.cacheMaxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return value;
  }

  private async fetchValidated<S extends z.ZodType>(
    url: string,
    schema: S,
  ): Promise<Sourced<z.output<S>>> {
    const { body, source } = await this.fetchWithRetries(url);
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
    return { data: parsed.data, source };
  }

  private async fetchWithRetries(url: string): Promise<{ body: unknown; source: Provenance }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      let retryAfterMs: number | undefined;
      try {
        // Hold a concurrency slot per attempt only, so backoff waits don't block other requests.
        return await this.limiter.run(() => this.fetchOnce(url));
      } catch (error) {
        // Network errors and timeouts are not DofApiErrors; a full queue fails fast.
        const retryable =
          !(error instanceof DofQueueFullError) &&
          (!(error instanceof DofApiError) ||
            error.status === undefined ||
            error.status === 429 ||
            error.status >= 500);
        if (!retryable) throw error;
        lastError = error;
        if (error instanceof RetryAfterError) retryAfterMs = error.retryAfterMs;
      }
      if (attempt === this.retries) break;
      if (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_AFTER_MS) break;
      const backoff = Math.random() * this.retryBaseDelayMs * 2 ** attempt;
      await sleep(Math.max(retryAfterMs ?? 0, backoff));
    }
    throw lastError instanceof Error
      ? lastError
      : new DofApiError(`Request to ${url} failed after ${this.retries + 1} attempts`);
  }

  private async fetchOnce(url: string): Promise<{ body: unknown; source: Provenance }> {
    const res = await this.fetchImpl(url, {
      headers: { Accept: ACCEPT_HEADER, "User-Agent": this.userAgent },
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 429 || res.status >= 500) {
      await res.body?.cancel().catch(() => {});
      throw new RetryAfterError(
        `SIDOF responded ${res.status}`,
        res.status,
        parseRetryAfter(res.headers.get("retry-after")),
      );
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      if (res.status === 404) {
        throw new DofNotFoundError(`SIDOF has no data for ${new URL(url).pathname} (HTTP 404)`);
      }
      throw new DofApiError(`SIDOF responded ${res.status}`, res.status);
    }
    const fetchedAt = new Date().toISOString();
    const bytes = await readLimited(res, this.maxResponseBytes);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new DofApiError("SIDOF returned a body that is not valid JSON", res.status);
    }
    const sha256 = await sha256Hex(bytes);
    return { body, source: { sourceUrl: url, fetchedAt, sha256, bytes: bytes.byteLength } };
  }
}
