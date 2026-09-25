// Encode raw bytes as base64 without a text round-trip. `Buffer` when it exists
// (Node / prerender) is both fastest and unbounded; otherwise `btoa` over the
// binary string, built in chunks so a large file doesn't blow the argument
// limit of `String.fromCharCode`. Reached through `globalThis` so the same
// helper type-checks and runs in both the browser host and the Node ai-bot.
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let maybeBuffer = (globalThis as any).Buffer as
    | { from(input: Uint8Array): { toString(encoding: string): string } }
    | undefined;
  if (typeof maybeBuffer !== 'undefined') {
    return maybeBuffer.from(bytes).toString('base64');
  }

  let btoaFn = (globalThis as any).btoa as
    | ((data: string) => string)
    | undefined;
  if (typeof btoaFn === 'function') {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoaFn(binary);
  }

  throw new Error('No base64 encoder available in this environment');
}
