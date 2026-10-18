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
    // One line per request, without IPs or arguments.
    console.log(
      JSON.stringify({
        method: event.requestContext.http.method,
        path: event.rawPath,
        status: result.statusCode,
        ms: Date.now() - started,
      }),
    );
    return result;
  };
}

let cached: LambdaHandler | undefined;

/** AWS Lambda entry point, built on the first invocation and reused while the instance lives. */
export const handler: LambdaHandler = (event) => {
  cached ??= createLambdaHandler();
  return cached(event);
};
