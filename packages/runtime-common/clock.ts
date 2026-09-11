// The instant anything measuring elapsed time should measure from.
//
// Unset, this is the real clock. Setting a number on `globalThis.__boxelNow`
// pins it, so what gets rendered becomes a function of the data rather than of
// when it was rendered.
//
// The number is epoch **milliseconds**, the same units `Date.now()` returns.
// Worth stating because a file's `lastModified` and `resourceCreatedAt` are
// stamped in epoch *seconds*, and `toDate` in
// `base/file-formats/file-presentation` exists to promote those — so seconds
// are the value nearest to hand for someone reaching for a pin. A
// seconds-valued pin lands in 1970, puts every real timestamp in its future,
// and turns every age into an absolute date. It throws nothing and produces no
// NaN; a snapshot diff reads it as a formatting change.
//
// `now()` deliberately does not promote seconds the way `toDate` does. A file
// mtime below the year-2001 millisecond floor is unambiguous, but a pin is
// chosen by its caller, and guessing would hide the mistake rather than
// surface it.
//
// That matters wherever output is an age — "3d ago", a countdown, "Last saved
// 6 days ago", a `Today` / `Yesterday` day header. Each changes on a schedule
// nobody chose, so a visual comparison of one differs between two runs over
// identical data, and the usual way to quiet that is to stop comparing the
// element, which trades the coverage away.
//
// Reading through here is what makes a renderer pinnable; one that calls the
// clock directly is not, whatever this comment says. The rule that keeps them
// converted lives with the lint config, because a list of callers here would
// be wrong the moment one is added.
//
// It lives in runtime-common rather than in either consumer because both sides
// of the card loader need it: card code reaches it through
// `base/helpers/clock`, and the host app imports it directly. A global is what
// crosses that boundary — the loader gives card code its own module instances,
// so a shared module-level variable would not be shared at all.
// `__boxelRenderContext` and its neighbours already work this way.
export function now(): number {
  let pinned = (globalThis as { __boxelNow?: unknown }).__boxelNow;
  return typeof pinned === 'number' && Number.isFinite(pinned)
    ? pinned
    : Date.now();
}

// The same instant as a `Date`, for callers that would otherwise write
// `new Date()`.
export function nowDate(): Date {
  return new Date(now());
}
