import { DofClient } from "./client.js";
import { createDofHttpHandler, type DofHttpHandler } from "./http.js";

/** The parts of an API Gateway HTTP API (payload format 2.0) event this adapter reads. */
export interface HttpApiEvent {
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded: boolean;
  requestContext: { domainName: string; http: { method: string } };
}

/** API Gateway HTTP API (payload format 2.0) response. */
export interface HttpApiResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
  cookies?: string[];
}

/** Header the CDN in front of the public endpoint adds; requests without it are refused. */
export const ORIGIN_SECRET_HEADER = "x-dof-origin-secret";

const MIN_SECRET_LENGTH = 32;

/** Requests to the public endpoint are small JSON-RPC messages. */
const MAX_BODY_BYTES = 64 * 1024;

export interface LambdaConfig {
  allowedHosts: string[];
  originSecret: string;
}

/**
 * Reads the deployment's settings from the environment, refusing to start without them:
 * `DOF_ALLOWED_HOSTS` (comma-separated public hostnames) and `DOF_ORIGIN_SECRET`.
 */
export function readLambdaConfig(env: Record<string, string | undefined>): LambdaConfig {
  const allowedHosts = (env.DOF_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== "");
  if (allowedHosts.length === 0) throw new Error("DOF_ALLOWED_HOSTS is not set");
  const originSecret = env.DOF_ORIGIN_SECRET ?? "";
  if (originSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`DOF_ORIGIN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return { allowedHosts, originSecret };
}

/** Converts an HTTP API event into a web-standard Request. */
export function toRequest(event: HttpApiEvent): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers)) {
    if (value !== undefined) headers.set(name, value);
  }
  if (event.cookies?.length) headers.set("cookie", event.cookies.join("; "));
  const host = headers.get("host") ?? event.requestContext.domainName;
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const method = event.requestContext.http.method;
  const hasBody = event.body !== undefined && method !== "GET" && method !== "HEAD";
  return new Request(`https://${host}${event.rawPath}${query}`, {
    method,
    headers,
    ...(hasBody
      ? { body: event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64") : event.body }
      : {}),
  });
}

/** Converts a web-standard Response into an HTTP API result, buffering the body. */
export async function toResult(response: Response): Promise<HttpApiResult> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  return {
    statusCode: response.status,
    headers,
    body: await response.text(),
    isBase64Encoded: false,
    ...(cookies.length > 0 ? { cookies } : {}),
  };
}

export interface LambdaHandlerOptions {
  env?: Record<string, string | undefined>;
  /** Defaults to a client tuned to answer within API Gateway's 30 s limit. */
  client?: DofClient;
}

export type LambdaHandler = (event: HttpApiEvent) => Promise<HttpApiResult>;

/** Builds the Lambda handler for the public endpoint. Throws if the configuration is missing. */
export function createLambdaHandler(options: LambdaHandlerOptions = {}): LambdaHandler {
  const config = readLambdaConfig(options.env ?? process.env);
  const handler: DofHttpHandler = createDofHttpHandler({
    client:
      options.client ??
      new DofClient({ timeoutMs: 5_000, retries: 1, maxConcurrency: 2, maxQueue: 16 }),
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedHosts,
    requiredHeader: { name: ORIGIN_SECRET_HEADER, value: config.originSecret },
    maxRequestBodySize: MAX_BODY_BYTES,
    // Lambda buffers the whole response, so a subscription stream would hang until timeout.
    maxSubscriptions: 0,
  });
  return async (event) => {
    const started = Date.now();
    const result = await toResult(await handler.fetch(toRequest(event)));
    // One line per request: what was called and by which client, never IPs or arguments.
    console.log(
      JSON.stringify({
        method: event.requestContext.http.method,
        path: event.rawPath,
        status: result.statusCode,
        ms: Date.now() - started,
        ...describeRequest(event),
        ...describeResponse(result.body),
      }),
    );
    return result;
  };
}

const CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";

/** Keeps client-supplied labels short and printable, so they cannot forge log lines. */
function label(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[^\w .@/+-]/g, "").slice(0, 64);
  return clean === "" ? undefined : clean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export interface RequestSummary {
  rpc?: string;
  tool?: string;
  client?: string;
  clientVersion?: string;
}

/**
 * Reads the JSON-RPC method, the tool name and the client's self-reported name from a request
 * body, for usage metrics. The client name comes from `initialize` (2025 clients) or from the
 * per-request `_meta` (2026-07-28 clients). Tool arguments are never read.
 */
export function describeRequest(
  event: Pick<HttpApiEvent, "body" | "isBase64Encoded">,
): RequestSummary {
  if (!event.body) return {};
  let message: unknown;
  try {
    const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body;
    message = JSON.parse(text);
  } catch {
    return {};
  }
  const root = asRecord(Array.isArray(message) ? message[0] : message);
  const params = asRecord(root?.params);
  const meta = asRecord(params?._meta);
  const clientInfo = asRecord(params?.clientInfo) ?? asRecord(meta?.[CLIENT_INFO_META_KEY]);
  const summary: RequestSummary = {};
  const rpc = label(root?.method);
  if (rpc) summary.rpc = rpc;
  if (rpc === "tools/call") {
    const tool = label(params?.name);
    if (tool) summary.tool = tool;
  }
  const client = label(clientInfo?.name);
  if (client) summary.client = client;
  const clientVersion = label(clientInfo?.version);
  if (clientVersion) summary.clientVersion = clientVersion;
  return summary;
}

/** Flags tool calls that came back as errors, plain JSON or a buffered SSE event. */
export function describeResponse(body: string): { toolError?: true } {
  const json = body.startsWith("event:")
    ? body
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length)
    : body;
  if (!json) return {};
  try {
    const result = asRecord(asRecord(JSON.parse(json))?.result);
    return result?.isError === true ? { toolError: true } : {};
  } catch {
    return {};
  }
}

let cached: LambdaHandler | undefined;

/** AWS Lambda entry point, built on the first invocation and reused while the instance lives. */
export const handler: LambdaHandler = (event) => {
  cached ??= createLambdaHandler();
  return cached(event);
};
