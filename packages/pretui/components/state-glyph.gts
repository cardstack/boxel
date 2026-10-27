// Pretui — StateGlyph: the transcript's state marks, drawn from boxel-icons.
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import AlertCircle from '@cardstack/boxel-icons/alert-circle';
import ArrowRight from '@cardstack/boxel-icons/arrow-right';
import ArrowUpRight from '@cardstack/boxel-icons/arrow-up-right';
import Check from '@cardstack/boxel-icons/check';
import Circle from '@cardstack/boxel-icons/circle';
import CircleDot from '@cardstack/boxel-icons/circle-dot';
import CircleHalf from '@cardstack/boxel-icons/circle-half-2';
import CornerDownRight from '@cardstack/boxel-icons/corner-down-right';
import Diamond from '@cardstack/boxel-icons/diamond';
import HelpCircle from '@cardstack/boxel-icons/help-circle';
import Minus from '@cardstack/boxel-icons/minus';
import Plus from '@cardstack/boxel-icons/plus';
import Point from '@cardstack/boxel-icons/point';
import RefreshCw from '@cardstack/boxel-icons/refresh-cw';
import Stop from '@cardstack/boxel-icons/player-stop';
import X from '@cardstack/boxel-icons/x';

type Icon = ComponentLike<{ Element: SVGSVGElement }>;

/** the marks, by name and by the character the parts have always used,
 * so `@glyph='✓'` and `@glyph='done'` draw the same icon */
const MARKS: Record<string, Icon> = {
  done: Check as Icon,
  '✓': Check as Icon,
  failed: X as Icon,
  '✕': X as Icon,
  '×': X as Icon,
  current: CircleHalf as Icon,
  '◐': CircleHalf as Icon,
  next: Circle as Icon,
  '○': Circle as Icon,
  needs: CircleDot as Icon,
  '●': CircleDot as Icon,
  retry: RefreshCw as Icon,
  '↻': RefreshCw as Icon,
  skipped: Minus as Icon,
  '–': Minus as Icon,
  '−': Minus as Icon,
  '-': Minus as Icon,
  warning: AlertCircle as Icon,
  '!': AlertCircle as Icon,
  note: Point as Icon,
  '·': Point as Icon,
  ask: HelpCircle as Icon,
  '?': HelpCircle as Icon,
  resolve: Diamond as Icon,
  '◇': Diamond as Icon,
  open: ArrowUpRight as Icon,
  '↗': ArrowUpRight as Icon,
  action: ArrowRight as Icon,
  '→': ArrowRight as Icon,
  steer: CornerDownRight as Icon,
  '↳': CornerDownRight as Icon,
  stop: Stop as Icon,
  '■': Stop as Icon,
  add: Plus as Icon,
  '+': Plus as Icon,
};

/** the icon a mark draws, or undefined for a character with none */
export function glyphIcon(glyph: string | undefined): Icon | undefined {
  return glyph ? MARKS[glyph] : undefined;
}

export interface StateGlyphSignature {
  Args: {
    /** a mark's name ('done', 'failed', 'current', 'next', 'retry',
     * 'skipped', 'warning', 'note', 'ask', 'resolve', 'open', 'action',
     * 'steer', 'stop', 'add', 'needs') or the character it replaces
     * ('✓', '✕', '◐', '○', '↻', '–', '!', '·', '?', '◇', '↗', '→', '↳', '■',
     * '+', '●'). Any other character is drawn as text */
    glyph?: string;
    /** px. Default 12 */
    size?: number;
  };
  Element: HTMLSpanElement;
}

/**
 * One state mark, as an icon from boxel-icons in the current colour, so
 * every part draws ✓ ✕ ◐ ○ ↻ the same way and a theme recolours them all.
 * Decorative: the state is always said in words beside it.
 */
export class StateGlyph extends Component<StateGlyphSignature> {
  get icon(): Icon | undefined {
    return glyphIcon(this.args.glyph);
  }
  get size(): string {
    return String(this.args.size ?? 12);
  }
  <template>
    <span
      class='pretui-glyph'
      aria-hidden='true'
      data-glyph={{@glyph}}
      data-test-pretui-state-glyph={{@glyph}}
      ...attributes
    >{{#if this.icon}}<this.icon
          width={{this.size}}
          height={{this.size}}
          class='pretui-glyph-icon'
        />{{else}}{{@glyph}}{{/if}}</span>
    <style scoped>
      @layer PretComponent {
        .pretui-glyph {
          display: inline-grid;
          place-items: center;
          line-height: 1;
          vertical-align: -0.125em;
        }
        .pretui-glyph-icon {
          display: block;
          stroke-width: 2.25;
        }
      }
    </style>
  </template>
}
