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

export function encodeWebSafeBase64(decoded: string) {
  return (
    Buffer.from(decoded)
      .toString('base64')
      // Replace + with - and / with _ to make base64 URL-safe (this is a requirement for client_reference_id query param in Stripe payment link)
      // Then remove any trailing = padding characters that are added by base64 encoding
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  );
}

export function decodeWebSafeBase64(encoded: string) {
  return Buffer.from(
    encoded.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf8');
}
