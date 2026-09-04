// The instant card code measures elapsed time from.
//
// Left alone this is the real clock. Setting a number on `globalThis.__boxelNow`
// pins it, so what a card renders becomes a function of its own data rather
// than of when it happened to be rendered.
//
// That distinction matters for anything whose output is an age. `3d ago`, a
// countdown, an "expires soon" warning: each changes on a schedule nobody
// chose, so a visual comparison of one differs between two runs over identical
// data, and the usual way to quiet that is to stop comparing the element at
// all. Pinning the clock instead keeps the value visible, so a change in how
// it is formatted still registers.
//
// Read off `globalThis` rather than taken as an argument because it has to
// reach card code through whichever loader instance rendered it, which no call
// site knows about. `__boxelRenderMode` and its neighbours already work this
// way.
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
