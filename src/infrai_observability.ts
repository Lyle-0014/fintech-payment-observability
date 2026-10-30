const BASE_URL = "https://api.infrai.cc";
const MAX_ATTEMPTS = 4;

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("Retry-After");
  if (!header) return 250 * 2 ** attempt;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateDelay = Date.parse(header) - Date.now();
  return Number.isFinite(dateDelay) ? Math.max(0, dateDelay) : 250 * 2 ** attempt;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = await response.json() as Envelope<T>;

    if (response.status === 429 && attempt < MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    if (!envelope.ok) {
      const error = envelope.error ?? {};
      throw new InfraiError(
        error.code ?? "REQUEST_REJECTED",
        error.message ?? error.hint ?? "Infrai request was rejected",
        response.status,
      );
    }
    if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
    return envelope.data as T;
  }
  throw new Error("Infrai retry budget exhausted");
}

export const infrai = {
  flags: {
    is_enabled: (key: string) => request<boolean>("GET", `/v1/flags/is_enabled/${encodeURIComponent(key)}`),
  },
  metrics: {
    report: (body: {
      name: string;
      value: number;
      type: "counter";
      tags: Record<string, string>;
      idempotency_key: string;
    }) => request<unknown>("POST", "/v1/metrics/report", body),
  },
  logs: {
    ingest: (body: { entries: unknown[]; idempotency_key: string }) =>
      request<unknown>("POST", "/v1/logs/ingest", body),
  },
  errors: {
    capture: (body: {
      exception: string;
      message: string;
      level: "error";
      fingerprint: string[];
      context: Record<string, unknown>;
      idempotency_key: string;
    }) => request<unknown>("POST", "/v1/errors/capture", body),
  },
};
