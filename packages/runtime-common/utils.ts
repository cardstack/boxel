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

/**
 * Encodes a string to web-safe base64 format.
 * Standard base64 uses '+', '/' and '=' which can cause issues in URLs and other web contexts.
 * This function replaces them with URL-safe alternatives:
 * '+' -> '-'
 * '/' -> '_'
 * '=' padding is removed
 */
export function encodeWebSafeBase64(text: string): string {
  return Buffer.from(text)
    .toString('base64')
    .replace(/\+/g, '-') // Convert + to - for URL safety
    .replace(/\//g, '_') // Convert / to _ for URL safety
    .replace(/=/g, ''); // Remove padding = signs
}

/**
 * Decodes a web-safe base64 string back to its original text.
 * Reverses the character substitutions made in encoding:
 * '-' -> '+'
 * '_' -> '/'
 * Restores required padding (=) based on string length before decoding.
 */
export function decodeWebSafeBase64(encoded: string): string {
  let base64 = encoded
    .replace(/-/g, '+') // Restore + from -
    .replace(/_/g, '/'); // Restore / from _

  // Base64 strings should have a length that's a multiple of 4.
  // If not, we need to add back the padding that was removed.
  switch (base64.length % 4) {
    case 2:
      base64 += '==';
      break;
    case 3:
      base64 += '=';
      break;
  }

  return Buffer.from(base64, 'base64').toString('utf-8');
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
  return `[job: ${jobInfo.jobId}] [jobReservation: ${jobInfo.reservationId}] [concurrencyGroup: ${jobInfo.concurrencyGroup}]`;
}
