// The instant card code measures elapsed time from.
//
// Left alone this is the real clock. Setting a number on `globalThis.__boxelNow`
// pins it, so what a card renders becomes a function of its own data rather
// than of when it happened to be rendered.
//
// The number is epoch **milliseconds**, the same units `Date.now()` returns.
// Worth stating because this package stamps a file's `lastModified` and
// `resourceCreatedAt` in epoch *seconds*, and `toDate` in
// `file-formats/file-presentation` exists to promote those — so seconds are
// the value nearest to hand for someone reaching for a pin. A seconds-valued
// pin lands in 1970, puts every real timestamp in its future, and turns every
// age into an absolute date through the `days < 0` branch. It throws nothing
// and produces no NaN; a snapshot diff reads it as a formatting change.
//
// `now()` deliberately does not promote seconds the way `toDate` does. A file
// mtime below the year-2001 millisecond floor is unambiguous, but a pin is
// chosen by its caller, and guessing would hide the mistake rather than
// surface it.
//
// That distinction matters for anything whose output is an age — `3d ago`, a
// countdown, an "expires soon" warning, a `Today` / `Yesterday` day header.
// Each changes on a schedule nobody chose, so a visual comparison of one
// differs between two runs over identical data, and the usual way to quiet
// that is to stop comparing the element at all. Pinning the clock instead
// keeps the value visible, so a change in how it is formatted still registers.
//
// Reading through here is what makes a renderer pinnable; a renderer that
// calls the clock directly is not, whatever this module says. The rule that
// keeps them converted lives with the lint config rather than in this comment,
// because a list of callers here would be wrong the moment one is added.
//
// Read off `globalThis` rather than taken as an argument because it has to
// reach card code through whichever loader instance rendered it, which no call
// site knows about. `__boxelRenderContext` and its neighbours already work
// this way.
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
