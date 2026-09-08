// The instant anything measuring elapsed time should measure from.
//
// Unset, this is the real clock. Setting a number on `globalThis.__boxelNow`
// pins it, so what gets rendered becomes a function of the data rather than of
// when it was rendered.
//
// That matters wherever output is an age — "3d ago", a countdown, "Last saved
// 6 days ago". Each changes on a schedule nobody chose, so a visual comparison
// of one differs between two runs over identical data, and the usual way to
// quiet that is to stop comparing the element, which trades the coverage away.
//
// It lives here rather than in either consumer because both sides of the card
// loader need it: card code in `packages/base` reaches it through
// `helpers/clock`, and the host app imports it directly. A global is what
// crosses that boundary — the loader gives card code its own module instances,
// so a shared module-level variable would not be shared at all.
// `__boxelRenderMode` and its neighbours already work this way.
export function now(): number {
  let pinned = (globalThis as { __boxelNow?: unknown }).__boxelNow;
  return typeof pinned === 'number' && Number.isFinite(pinned)
    ? pinned
    : Date.now();
}

export function nowDate(): Date {
  return new Date(now());
}
