// Render an arbitrary thrown value into a single human-readable string
// for FD-level fatal-exit logging in `worker.ts`. The output must be
// self-contained (no console formatting hooks, no Error toString
// reflection that can throw) because it gets handed straight to
// `writeSync(2, ...)` on a hot path right before `process.exit(1)`.
//
// What we want preserved across the pipe:
//   - the error's name + message (or stringified non-Error value)
//   - the stack trace (otherwise we still can't see where it threw)
//   - the cause chain (Node fetch errors and many internal libs
//     stash the real reason there; ECONNRESET, TLS errors, etc.)
//
// Newlines inside the rendered output are fine — the caller's wrapping
// `[worker] FATAL ... : <this>\n` is the only line boundary readers
// of `worker-manager.ts`'s stderr-data tee actually expect.
// `Error.cause` is an ES2022 field. The realm-server package still
// targets a slightly older lib in tsconfig (the runtime has had it
// since Node 16.9, but the type definitions don't expose it), so we
// reach for it through a structural cast.
type WithCause = { cause?: unknown };

export function serializeFatalReason(reason: unknown): string {
  // Defense in depth: anything inside that throws (e.g.
  // `String(Object.create(null))` synthesizing a `TypeError` because
  // a prototype-less object has no `toString`/`valueOf`, or a user
  // type whose `toString` itself throws) would otherwise propagate
  // out into `fatalExit` after it has already set
  // `isFatalHandlerRunning = true`, and the resulting re-entered
  // `uncaughtException` would early-return without finalizing the
  // reservation or calling `process.exit(1)`. That leaves the worker
  // alive in a broken state, holding its pg-queue reservation. The
  // fatal path must never throw, so swallow everything here.
  try {
    if (!(reason instanceof Error)) {
      return safeString(reason);
    }
    let parts: string[] = [];
    parts.push(reason.stack ?? `${reason.name}: ${reason.message}`);
    let cause: unknown = (reason as WithCause).cause;
    // Walk the cause chain. Defensive bound prevents a (pathological)
    // self-referential cause from looping forever.
    let depth = 0;
    while (cause !== undefined && depth < 8) {
      if (cause instanceof Error) {
        parts.push(
          `Caused by: ${cause.stack ?? `${cause.name}: ${cause.message}`}`,
        );
        cause = (cause as WithCause).cause;
      } else {
        parts.push(`Caused by: ${safeString(cause)}`);
        cause = undefined;
      }
      depth += 1;
    }
    return parts.join('\n');
  } catch (innerErr) {
    let innerMsg: string;
    try {
      innerMsg =
        innerErr instanceof Error ? innerErr.message : safeString(innerErr);
    } catch {
      innerMsg = 'unknown';
    }
    return `[serializeFatalReason failed: ${innerMsg}]`;
  }
}

// `String(value)` throws on a prototype-less object (no `toString` /
// `valueOf` to call), and on any value whose own `toString` throws.
// Wrap the call so callers can rely on getting a string back.
function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unstringifiable value]';
  }
}
