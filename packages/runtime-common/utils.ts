import type { JobInfo } from './worker';

export async function retry<T>(
  fn: () => Promise<T | null>,
  { retries, delayMs }: { retries: number; delayMs: number },
): Promise<T | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await fn();
      if (result !== null) {
        return result;
      }
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error);
    }

    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return null;
}

export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// This is the djb2_xor hash function from http://www.cse.yorku.ca/~oz/hash.html
export function simpleHash(str: string) {
  let len = str.length;
  let h = 5381;

  for (let i = 0; i < len; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function jobIdentity(jobInfo?: JobInfo): string {
  if (!jobInfo) {
    return `[no job identity]`;
  }
  return `[job: ${jobInfo.jobId}.${jobInfo.reservationId}]`;
}

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
