// Shared by the timestamp field blocks (created-at-field, updated-at-field).

const UNITS: [limitSeconds: number, divisorSeconds: number, suffix: string][] =
  [
    [60, 1, 's'],
    [3600, 60, 'm'],
    [86400, 3600, 'h'],
    [604800, 86400, 'd'],
    [2629800, 604800, 'w'],
    [31557600, 2629800, 'mo'],
    [Infinity, 31557600, 'y'],
  ];

/** "3d ago" / "in 2h" / "just now". Sign-aware so an anomalous future stamp is visible rather than clamped. */
export function relativeStamp(value: Date | null | undefined): string | undefined {
  if (!value || Number.isNaN(value.getTime())) {
    return undefined;
  }
  let diffSeconds = (Date.now() - value.getTime()) / 1000;
  let past = diffSeconds >= 0;
  let magnitude = Math.abs(diffSeconds);
  if (magnitude < 60) {
    return 'just now';
  }
  for (let [limit, divisor, suffix] of UNITS) {
    if (magnitude < limit) {
      let n = Math.floor(magnitude / divisor);
      return past ? `${n}${suffix} ago` : `in ${n}${suffix}`;
    }
  }
  return undefined;
}

/** "26 Aug 2026, 14:41" — the audit-precision form. */
export function absoluteStamp(value: Date | null | undefined): string | undefined {
  if (!value || Number.isNaN(value.getTime())) {
    return undefined;
  }
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}
