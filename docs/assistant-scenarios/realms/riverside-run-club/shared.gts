// What every Riverside card shares: the palette, the type, and the one
// gesture the club is recognised by, a route drawn as a single line.
import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';

export const INK = '#0d1522';
export const PAPER = '#f4f1ea';
export const LIME = '#c6f432';

export function safeColor(value: string | undefined | null, fallback: string) {
  let color = (value ?? '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback;
}

export function accentStyle(name: string, value: string | undefined | null, fallback: string) {
  return htmlSafe(`--${name}: ${safeColor(value, fallback)}`);
}

// 312 seconds a kilometre reads "5:12"
export function paceLabel(seconds: number | undefined | null) {
  if (!seconds) {
    return '';
  }
  let minutes = Math.floor(seconds / 60);
  let rest = String(Math.round(seconds % 60)).padStart(2, '0');
  return `${minutes}:${rest}`;
}

export function kmLabel(km: number | undefined | null) {
  if (km == null) {
    return '';
  }
  return Number.isInteger(km) ? `${km}` : km.toFixed(1);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dateParts(value: Date | string | undefined | null) {
  if (!value) {
    return undefined;
  }
  let date = typeof value === 'string' ? new Date(`${value}T12:00:00`) : value;
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return {
    day: String(date.getDate()),
    month: MONTHS[date.getMonth()]!,
    weekday: DAYS[date.getDay()]!,
  };
}

export function initialsOf(name: string | undefined | null) {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

interface RouteLineSignature {
  Args: {
    // an SVG path in a 120 by 60 box
    path?: string | null;
    // draws the start as a dot and the line at this weight
    weight?: number;
    start?: boolean;
  };
  Element: SVGSVGElement;
}

// The route as one stroke in the current colour. Every card that has a
// route draws it with this, so the club reads the same at pill size and at
// poster size.
export class RouteLine extends GlimmerComponent<RouteLineSignature> {
  get weight() {
    return this.args.weight ?? 3;
  }
  get startPoint() {
    let match = /^M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(this.args.path ?? '');
    return match ? { x: match[1], y: match[2] } : undefined;
  }
  <template>
    <svg
      class='route-line'
      viewBox='-4 -4 128 68'
      preserveAspectRatio='xMidYMid meet'
      aria-hidden='true'
      ...attributes
    >
      {{#if @path}}
        <path
          d={{@path}}
          fill='none'
          stroke='currentColor'
          stroke-width={{this.weight}}
          stroke-linecap='round'
          stroke-linejoin='round'
          vector-effect='non-scaling-stroke'
        />
        {{#if @start}}
          {{#if this.startPoint}}
            <circle
              cx={{this.startPoint.x}}
              cy={{this.startPoint.y}}
              r='3.2'
              fill='currentColor'
            />
          {{/if}}
        {{/if}}
      {{/if}}
    </svg>
    <style scoped>
      .route-line {
        display: block;
        overflow: visible;
      }
    </style>
  </template>
}
