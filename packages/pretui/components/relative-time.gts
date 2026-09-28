// Pretui — RelativeTime: a date as a phrase relative to a caller-supplied now.
import Component from '@glimmer/component';
import { ABS_FMT } from '../internal/reading-extras';

// ── RelativeTime ─────────────────────────────────────────────────────────
// webawesome relative-time semantics, realm-adapted: the phrase is computed
// ONCE from @date vs @now (Intl.RelativeTimeFormat) and re-derives only when
// the args change. @now is caller-supplied per the LoadingState precedent;
// when omitted it captures the construction instant. It does NOT auto-tick —
// the realm forbids timers, so "2 minutes ago" stays put until the caller
// refreshes @now.
export interface RelativeTimeSignature {
  Args: {
    date: string | Date;
    now?: string | Date;
    format?: 'long' | 'short' | 'narrow';
    numeric?: 'always' | 'auto';
  };
  Element: HTMLTimeElement;
}

const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365.25 * 24 * 3600e3 },
  { unit: 'month', ms: 30.44 * 24 * 3600e3 },
  { unit: 'week', ms: 7 * 24 * 3600e3 },
  { unit: 'day', ms: 24 * 3600e3 },
  { unit: 'hour', ms: 3600e3 },
  { unit: 'minute', ms: 60e3 },
];

function asDate(value: string | Date | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  let d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export class RelativeTime extends Component<RelativeTimeSignature> {
  // Captured once — the no-timer stand-in for "now" when @now is omitted.
  private constructedAt = new Date();

  get dateObj(): Date | undefined {
    return asDate(this.args.date);
  }
  get nowObj(): Date {
    return asDate(this.args.now) ?? this.constructedAt;
  }
  get phrase(): string {
    let date = this.dateObj;
    if (!date) {
      return '';
    }
    let diff = date.getTime() - this.nowObj.getTime();
    let match = RELATIVE_UNITS.find((u) => Math.abs(diff) >= u.ms);
    let unit: Intl.RelativeTimeFormatUnit = match?.unit ?? 'second';
    let ms = match?.ms ?? 1e3;
    let fmt = new Intl.RelativeTimeFormat('en-US', {
      style: this.args.format ?? 'long',
      numeric: this.args.numeric ?? 'auto',
    });
    return fmt.format(Math.round(diff / ms), unit);
  }
  get datetimeAttr(): string | undefined {
    return this.dateObj?.toISOString();
  }
  get titleAttr(): string | undefined {
    let d = this.dateObj;
    return d ? ABS_FMT.format(d) : undefined;
  }
  <template>
    <time
      class='pretui-relative-time'
      datetime={{this.datetimeAttr}}
      title={{this.titleAttr}}
      data-test-pretui-relative-time
      ...attributes
    >{{this.phrase}}</time>
    <style scoped>
      .pretui-relative-time {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}
