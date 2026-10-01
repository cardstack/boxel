// Pretui — Swatch: a selectable colour swatch.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { describeColor, parseColor, toHex } from '../color-engine';
import type { ColorValue } from '../color-engine';
import { SwatchChip } from './swatch-chip';

// ── Swatch ───────────────────────────────────────────────────────────────

/**
 * A colour chip. Round by default, square when `@shape='square'`.
 *
 * Two things it now does that the previous version did not:
 *
 *  * **`@color` is parsed and re-serialized before it reaches the style.**
 *    The old implementation interpolated the caller's string directly, so a
 *    `@color` of `red; background: url(…)` injected declarations.
 *  * **Its accessible name carries the hex and a colour word**, not just the
 *    raw string a caller happened to pass — so a swatch is legible to a
 *    screen reader without relying on colour.
 */
export interface SwatchSignature {
  Args: {
    /** Any CSS colour. Anything unparseable renders as the empty state. */
    color: string;
    /** Visible label beside the chip. */
    label?: string;
    /** Round (default) or square, which reads better in a dense grid. */
    shape?: 'round' | 'square';
    /** Chip size in px. Defaults to the `--pretui-swatch-size` token. */
    size?: number;
    selected?: boolean;
    disabled?: boolean;
    /** Interactive when given; otherwise the swatch renders as a static
     *  chip with no button semantics. */
    onSelect?: (color: string) => void;
  };
  Element: HTMLButtonElement;
}

export class Swatch extends Component<SwatchSignature> {
  get parsed(): ColorValue | null {
    return parseColor(this.args.color);
  }
  get accessibleName(): string {
    if (this.args.label) {
      return this.args.label;
    }
    let parsed = this.parsed;
    return parsed ? describeColor(parsed) : 'No colour';
  }
  get title(): string {
    let parsed = this.parsed;
    return parsed ? toHex(parsed) : 'No colour';
  }
  handleClick = () => {
    this.args.onSelect?.(this.args.color);
  };
  <template>
    <button
      type='button'
      class='pretui-swatch'
      data-shape={{if @shape @shape 'round'}}
      data-state={{if @selected 'selected'}}
      data-empty={{unless this.parsed 'true'}}
      disabled={{@disabled}}
      aria-pressed={{if @selected 'true' 'false'}}
      aria-label={{this.accessibleName}}
      title={{this.title}}
      data-test-pretui-swatch={{@color}}
      {{on 'click' this.handleClick}}
      ...attributes
    >
      <SwatchChip @color={{@color}} @shape={{@shape}} @size={{@size}} />
      {{#if @label}}<span class='pretui-swatch-label'>{{@label}}</span>{{/if}}
    </button>
    <style scoped>
      .pretui-swatch {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 0;
        background: none;
        padding: 2px;
        border-radius: 999px;
        font: inherit;
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-swatch[disabled] {
        cursor: not-allowed;
        opacity: 0.5;
      }
      .pretui-swatch:hover:not([disabled]) .pretui-swatch-chip {
        transform: scale(1.1);
      }
      .pretui-swatch:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .pretui-swatch[data-state='selected'] .pretui-swatch-chip {
        box-shadow:
          inset 0 0 0 1px
            color-mix(in oklch, var(--foreground) 14%, transparent),
          0 0 0 2px var(--card),
          0 0 0 3.5px var(--primary);
      }
      .pretui-swatch[data-state='selected'] .pretui-swatch-label {
        color: var(--foreground);
        font-weight: 500;
      }
    </style>
  </template>
}
