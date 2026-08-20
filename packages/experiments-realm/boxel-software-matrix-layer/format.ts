/**
 * Shared display formatters.
 *
 * These existed as private copies inside contract-execution-app.gts while the
 * card templates rendered raw values — which is how a Contract Request came to
 * show "Thu Oct 15 2026 00:00:00 GMT+0800 (Malaysia Time)" as its hero figure.
 * One module so a date looks the same in a table cell, a hero and a fitted card.
 */

/**
 * `2026-10-15`.
 *
 * NOT `toISOString()`: that converts to UTC first, so a local date renders a
 * day early or late depending on the offset. On a notice deadline or a needed-by
 * date, a day out is a missed obligation rather than a cosmetic slip.
 */
export function formatDay(v: unknown): string {
  if (!v) return '—';
  let d = new Date(v as any);
  if (Number.isNaN(d.getTime())) return String(v);
  let m = `${d.getMonth() + 1}`.padStart(2, '0');
  let day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** `2026-10-15 14:32`, for events where the time of day is part of the record. */
export function formatStamp(v: unknown): string {
  if (!v) return '—';
  let d = new Date(v as any);
  if (Number.isNaN(d.getTime())) return String(v);
  let hh = `${d.getHours()}`.padStart(2, '0');
  let mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${formatDay(v)} ${hh}:${mm}`;
}

/** `out_for_signature` -> `Out for signature`. */
export function humanise(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  let t = String(v).replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
