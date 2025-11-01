export const DEFAULT_FULL_REINDEX_CONCURRENCY = 1;
const DEFAULT_FULL_REINDEX_BATCH_SIZE = 4;
const DEFAULT_FULL_REINDEX_COOLDOWN_SEC = 10;

function readEnvNumber(name: string): number | undefined {
  let env =
    typeof globalThis !== 'undefined' &&
    (globalThis as any)?.process?.env &&
    typeof (globalThis as any).process.env === 'object'
      ? ((globalThis as any).process.env as Record<string, string | undefined>)
      : undefined;
  if (!env) {
    return undefined;
  }
  let raw = env[name];
  if (typeof raw !== 'string' || raw.length === 0) {
    return undefined;
  }
  let parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isValidPositiveInteger(
  value: number | undefined | null,
): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1;
}

export function normalizeFullReindexBatchSize(value?: number | null): number {
  if (isValidPositiveInteger(value)) {
    return Math.floor(value);
  }
  let envValue = readEnvNumber('FULL_REINDEX_BATCH_SIZE');
  if (isValidPositiveInteger(envValue)) {
    return Math.floor(envValue);
  }
  return DEFAULT_FULL_REINDEX_BATCH_SIZE;
}

export const FROM_SCRATCH_JOB_TIMEOUT_SEC = 20 * 60;

function isValidNonNegativeInteger(
  value: number | undefined | null,
): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function normalizeFullReindexCooldownSeconds(
  value?: number | null,
): number {
  if (isValidNonNegativeInteger(value)) {
    return Math.floor(value);
  }
  let envValue = readEnvNumber('FULL_REINDEX_COOLDOWN_SEC');
  if (isValidNonNegativeInteger(envValue)) {
    return Math.floor(envValue);
  }
  return DEFAULT_FULL_REINDEX_COOLDOWN_SEC;
}

export function fullReindexBatchTimeoutSeconds(
  batchSize: number,
  cooldownSeconds?: number,
): number {
  let normalizedBatchSize = normalizeFullReindexBatchSize(batchSize);
  let normalizedCooldown = normalizeFullReindexCooldownSeconds(cooldownSeconds);
  let totalJobTime = normalizedBatchSize * FROM_SCRATCH_JOB_TIMEOUT_SEC;
  let totalCooldownTime =
    Math.max(normalizedBatchSize - 1, 0) * normalizedCooldown;
  return totalJobTime + totalCooldownTime;
}

export function defaultFullReindexBatchSize(): number {
  return normalizeFullReindexBatchSize();
}

export function defaultFullReindexCooldownSeconds(): number {
  return normalizeFullReindexCooldownSeconds();
}

export function normalizeFullReindexConcurrency(
  valueStr?: string | null,
): number {
  let value: number | undefined;
  if (valueStr) {
    value = parseInt(valueStr);
  }
  if (isValidPositiveInteger(value)) {
    return Math.floor(value);
  }
  let envValue = readEnvNumber('FULL_REINDEX_CONCURRENCY');
  if (isValidPositiveInteger(envValue)) {
    return Math.floor(envValue);
  }
  return DEFAULT_FULL_REINDEX_CONCURRENCY;
}
