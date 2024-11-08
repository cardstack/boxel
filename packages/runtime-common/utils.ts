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
