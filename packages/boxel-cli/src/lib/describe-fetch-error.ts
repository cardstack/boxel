// Node's `fetch` error surface is shallow: the outer error is always
// `TypeError: fetch failed`, and the *real* reason (ECONNRESET, TLS
// failure, undici socket error, etc.) lives on `error.cause`. Inline
// both when summarizing a failed fetch for log output or for embedding
// in a result string returned from a higher-level operation, so that
// opaque "fetch failed" lines don't reach the operator without context.
//
// `error.cause != null` rather than a truthy check so we don't drop
// falsy-but-defined causes (`''`, `0`, `false`, `NaN`). `!= null`
// matches both `null` and `undefined` — i.e., the absence markers —
// and lets every explicit value through.
//
// For user-facing CLI output where the full nested Error (including
// stack frames) is useful, prefer logging `err` and `err.cause` as
// separate console.error arguments so Node pretty-prints them. This
// helper is for the case where the output needs to be a single string.
export function describeFetchError(error: unknown): string {
  let msg = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.cause != null) {
    let cause = error.cause;
    let causeMsg = cause instanceof Error ? cause.message : String(cause);
    return `${msg} (caused by: ${causeMsg})`;
  }
  return msg;
}
