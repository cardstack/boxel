// Pretui — Rating: score as a row of selectable symbols. Ported from
// Web Awesome's wa-rating (MIT, (c) Fonticons), re-cut on Pretui bones.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { cssStyle } from '../pretui-css';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlNotifyArgs } from '../pretui-primitives';


// Rating — ported from Web Awesome's wa-rating (MIT, (c) Fonticons) as the
// harmonization pilot: WA's semantic surface (precision, hover preview,
// click-to-clear, slider keyboard model) re-cut on Pretui bones. WA's
// --symbol-* knobs become --pretui-rating-*; the active color obeys Law 2
// (one hue in). Wave-0 adaptations: LTR only, and no pointer-capture touch
// scrubbing (lint forbids pointer-down bindings) — tap/hover/keyboard carry
// the interaction; both noted for the polish pass.
export interface RatingSignature {
  Args: ControlNotifyArgs<number> & {
    value?: number;
    defaultValue?: number;
    max?: number;
    precision?: number;
    readonly?: boolean;
    disabled?: boolean;
    label?: string;
    hue?: string;
    onHover?: (phase: 'start' | 'move' | 'end', value: number) => void;
    /** aliases — React Aria / HTML boolean spellings */
    isReadOnly?: boolean;
    readOnly?: boolean;
    isDisabled?: boolean;
  };
  Element: HTMLDivElement;
}

interface RatingSymbol {
  frac: number;
  hover: boolean;
  clipStyle: ReturnType<typeof htmlSafe> | undefined;
}

export class Rating extends Component<RatingSignature> {
  @tracked internal = this.args.defaultValue ?? 0;
  @tracked hoverValue = 0;
  @tracked isHovering = false;

  get value() {
    return this.args.value ?? this.internal;
  }
  get max() {
    return this.args.max ?? 5;
  }
  get precision() {
    return this.args.precision ?? 1;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get readonly() {
    return (
      firstDefined(
        this.args.readonly,
        this.args.isReadOnly,
        this.args.readOnly,
      ) ?? false
    );
  }
  get interactive() {
    return !this.disabled && !this.readonly;
  }
  get displayValue() {
    return this.interactive && this.isHovering ? this.hoverValue : this.value;
  }
  get hueStyle() {
    // `@hue` is a caller string reaching an inline style — validated against
    // the kit allowlist so it cannot carry its own declarations.
    return cssStyle('--pretui-rating-hue', this.args.hue);
  }
  get symbols(): RatingSymbol[] {
    let d = this.displayValue;
    return Array.from({ length: this.max }, (_v, i) => {
      let frac = Math.min(Math.max(d - i, 0), 1);
      return {
        frac,
        hover: this.isHovering && Math.ceil(d) === i + 1,
        clipStyle:
          frac > 0 && frac < 1
            ? htmlSafe(`clip-path: inset(0 ${(100 - frac * 100).toFixed(1)}% 0 0)`)
            : undefined,
      };
    });
  }

  private roundToPrecision(n: number) {
    let m = 1 / this.precision;
    return Math.ceil(n * m) / m;
  }
  private valueFromX(el: HTMLElement, clientX: number) {
    let { left, width } = el.getBoundingClientRect();
    let raw = this.roundToPrecision(((clientX - left) / width) * this.max);
    return Math.min(Math.max(raw, 0), this.max);
  }
  private commit(v: number) {
    // Clicking the current value clears the rating — the WA toggle semantic.
    let next = v === this.value ? 0 : v;
    if (this.args.value === undefined) {
      this.internal = next;
    }
    this.isHovering = false;
    emit([this.args.onValueChange, this.args.onChange], next);
  }

  handleClick = (e: Event) => {
    if (!this.interactive) return;
    let ev = e as MouseEvent;
    this.commit(this.valueFromX(ev.currentTarget as HTMLElement, ev.clientX));
  };
  handleKeyDown = (e: Event) => {
    if (!this.interactive) return;
    let ev = e as KeyboardEvent;
    let step = ev.shiftKey ? 1 : this.precision;
    let next: number | undefined;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowLeft') {
      next = Math.max(0, this.value - step);
    } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') {
      next = Math.min(this.max, this.value + step);
    } else if (ev.key === 'Home') {
      next = 0;
    } else if (ev.key === 'End') {
      next = this.max;
    }
    if (next !== undefined) {
      ev.preventDefault();
      if (next !== this.value) {
        if (this.args.value === undefined) {
          this.internal = next;
        }
        emit([this.args.onValueChange, this.args.onChange], next);
      }
    }
  };
  handlePointerEnter = (e: Event) => {
    if (!this.interactive) return;
    let ev = e as PointerEvent;
    this.isHovering = true;
    this.hoverValue = this.valueFromX(ev.currentTarget as HTMLElement, ev.clientX);
    this.args.onHover?.('start', this.hoverValue);
  };
  handlePointerMove = (e: Event) => {
    if (!this.interactive) return;
    let ev = e as PointerEvent;
    let v = this.valueFromX(ev.currentTarget as HTMLElement, ev.clientX);
    if (v !== this.hoverValue) {
      this.hoverValue = v;
      this.args.onHover?.('move', v);
    }
  };
  handlePointerLeave = () => {
    if (!this.interactive) return;
    this.isHovering = false;
    this.args.onHover?.('end', this.hoverValue);
  };
  <template>
    <div
      class='pretui-rating'
      role='slider'
      tabindex={{if this.interactive '0' '-1'}}
      aria-label={{if @label @label 'Rating'}}
      aria-valuemin='0'
      aria-valuemax={{this.max}}
      aria-valuenow={{this.value}}
      aria-disabled={{if this.disabled 'true' 'false'}}
      aria-readonly={{if this.readonly 'true' 'false'}}
      data-disabled={{if this.disabled 'true'}}
      data-readonly={{if this.readonly 'true'}}
      data-test-pretui-rating
      style={{this.hueStyle}}
      {{on 'click' this.handleClick}}
      {{on 'keydown' this.handleKeyDown}}
      {{on 'pointerenter' this.handlePointerEnter}}
      {{on 'pointermove' this.handlePointerMove}}
      {{on 'pointerleave' this.handlePointerLeave}}
      ...attributes
    >
      {{#each this.symbols as |s|}}
        <span
          class='pretui-rating-symbol'
          data-hover={{if s.hover 'true'}}
          aria-hidden='true'
        >
          <svg class='pretui-rating-base' viewBox='0 0 24 24' role='presentation'>
            <path
              role='presentation'
              d='M12 17.75l-6.172 3.245 1.179-6.873-5-4.867 6.9-1 3.093-6.253 3.093 6.253 6.9 1-5 4.867 1.179 6.873z'
            />
          </svg>
          {{#if s.frac}}
            <svg
              class='pretui-rating-fill'
              viewBox='0 0 24 24'
              role='presentation'
              style={{s.clipStyle}}
            >
              <path
                role='presentation'
                d='M12 17.75l-6.172 3.245 1.179-6.873-5-4.867 6.9-1 3.093-6.253 3.093 6.253 6.9 1-5 4.867 1.179 6.873z'
              />
            </svg>
          {{/if}}
        </span>
      {{/each}}
    </div>
    <style scoped>
      .pretui-rating {
        display: inline-flex;
        gap: var(--pretui-rating-gap, 2px);
        cursor: pointer;
        outline-offset: 4px;
        border-radius: 4px;
      }
      .pretui-rating[data-readonly],
      .pretui-rating[data-disabled] {
        cursor: default;
      }
      .pretui-rating[data-disabled] {
        opacity: 0.45;
      }
      .pretui-rating-symbol {
        position: relative;
        display: inline-grid;
        width: var(--pretui-rating-size, 18px);
        height: var(--pretui-rating-size, 18px);
        transition: transform 120ms ease;
      }
      .pretui-rating-symbol[data-hover='true'] {
        transform: scale(1.12);
      }
      .pretui-rating-symbol svg {
        grid-area: 1 / 1;
        width: 100%;
        height: 100%;
      }
      .pretui-rating-base {
        fill: none;
        stroke: var(--pretui-rating-track, var(--line-strong, var(--boxel-400)));
        stroke-width: 1.5;
        stroke-linejoin: round;
      }
      .pretui-rating-fill {
        fill: var(--pretui-rating-hue, var(--warning, var(--boxel-warning)));
        stroke: var(--pretui-rating-hue, var(--warning, var(--boxel-warning)));
        stroke-width: 1.5;
        stroke-linejoin: round;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-rating-symbol {
          transition: none;
        }
      }
    </style>
  </template>
}
