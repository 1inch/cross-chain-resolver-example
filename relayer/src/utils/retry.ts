export interface RetryOptions {
  readonly retries?: number; // total attempts including first
  readonly minDelayMs?: number; // base delay
  readonly maxDelayMs?: number; // cap delay
  readonly factor?: number; // backoff factor
  readonly jitter?: boolean; // add random jitter
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const DEFAULTS: Required<RetryOptions> = {
  retries: 3,
  minDelayMs: 250,
  maxDelayMs: 3000,
  factor: 2,
  jitter: true,
  shouldRetry: () => true,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelay(base: number, factor: number, attempt: number, max: number, jitter: boolean): number {
  const exp = Math.min(max, base * Math.pow(factor, attempt - 1));
  if (!jitter) return exp;
  const rand = Math.random() * exp * 0.3; // up to 30% jitter
  return Math.min(max, Math.floor(exp + rand));
}

export async function withRetry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
  const cfg = { ...DEFAULTS, ...(opts || {}) };
  let lastErr: unknown;
  for (let attempt = 1; attempt <= cfg.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!cfg.shouldRetry(err, attempt) || attempt === cfg.retries) {
        break;
      }
      const delay = computeDelay(cfg.minDelayMs, cfg.factor, attempt, cfg.maxDelayMs, cfg.jitter);
      await sleep(delay);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-throw-literal
  throw lastErr;
}
