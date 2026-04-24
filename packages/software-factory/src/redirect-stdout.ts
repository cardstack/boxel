/**
 * Run `fn` with all writes to `process.stdout` re-routed to `process.stderr`.
 *
 * `BoxelCLIClient.pull` / `.sync` emit progress output in two ways:
 *   1. `console.log(...)` — banners, sync plans, per-file upload lines.
 *   2. `process.stdout.write('\r...')` — interactive progress tickers.
 *
 * The factory CLI reserves stdout for its final JSON summary. If either
 * stream of progress reaches stdout:
 *   - the JSON summary gets corrupted, and
 *   - the terminal interleaves bytes from stdout and stderr at byte
 *     boundaries, which drops characters mid-word (e.g. "Realm access
 *     veried" instead of "verified") on many terminals.
 *
 * Forcing everything onto stderr keeps writes on a single stream, so
 * the ordering is deterministic and nothing corrupts the summary.
 */
export async function withStdoutRedirected<T>(
  fn: () => Promise<T>,
): Promise<T> {
  let originalLog = console.log;
  let originalWrite = process.stdout.write.bind(process.stdout);

  console.log = (...args: unknown[]) => {
    console.error(...args);
  };
  process.stdout.write = ((
    ...args: Parameters<typeof process.stderr.write>
  ) => {
    return process.stderr.write(...args);
  }) as typeof process.stdout.write;

  try {
    return await fn();
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }
}
