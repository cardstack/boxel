// Pretui — FilterChips: a row of filter chips, radio or multi-select.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { guidFor } from '@ember/object/internals';
import { cssNumber, cssStyle } from '../pretui-css';
import { emit, firstDefined } from '../pretui-primitives';
import { Menu } from './menu';
import type { MenuEntry } from '../internal/menu';

export interface FilterChipOption {
  value: string;
  label: string;
  count?: number;
  hue?: string;
}

export interface FilterChipsSignature {
  Args: {
    options?: FilterChipOption[];
    /** alias — the canonical flat-collection noun */
    items?: FilterChipOption[];
    /** single-select (default mode) */
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    /** alias — the HTML/Mantine/Ant notify name */
    onChange?: (value: string) => void;
    /**
     * Multi-select. Filter rows are multi-select far more often than not —
     * "show me open AND blocked" is the ordinary ask. Switches the chips from
     * radios to checkboxes, which is also the correct ARIA change: one tab
     * stop and arrows for a single choice, one tab stop per chip when any
     * combination is legal.
     */
    multiple?: boolean;
    /** selected values in multi-select mode */
    values?: string[];
    defaultValues?: string[];
    onValuesChange?: (values: string[]) => void;
    /** alias — the multi-select notify an agent will reach for */
    onSelectionChange?: (values: string[]) => void;
    /** Accessible name for the row. Chip rows almost never sit under a
     * visible heading, so this is worth passing. */
    label?: string;
    /**
     * Reserve the count slot on every chip even where no count has arrived
     * yet. Counts usually resolve one query at a time; without a reserved
     * slot each arrival re-flows the whole row. Defaults to true as soon as
     * any option declares a count.
     */
    reserveCounts?: boolean;
    /** width of the reserved count slot, in digits (default 2) */
    countDigits?: number;
    /** 'all' (default) every chip, wrapping as needed; 'few' the first
     * @visibleCount chips plus any selected one, on one line, with the rest
     * behind a '+N' menu */
    display?: 'all' | 'few';
    /** chips shown under @display 'few' (default 3) */
    visibleCount?: number;
    /** the '+N' trigger's name after its visible '+N', and the overflow
     * menu's name when @label is absent (default 'more filters') */
    moreLabel?: string;
  };
  Element: HTMLDivElement;
}

// Adopted from Beautiful UI: status chips that filter live data.
//
// **A radiogroup, not a tablist**, like SegmentedControl: `role='tablist'` over plain `<button>`s is invalid ARIA (a
// tablist's children must be tabs) and the wrong pattern — a filter row picks
// a value, it does not swap a panel. Single-select is native
// `<input type='radio'>` in a `role='radiogroup'`, sharing `RadioGroup`'s
// foundation and inheriting the whole APG contract for free; multi-select is
// native `<input type='checkbox'>` in a `role='group'`. The chip dress is
// unchanged — the input is visually hidden and the `<label>` wears it.
export class FilterChips extends Component<FilterChipsSignature> {
  @tracked internalValue =
    this.args.defaultValue ??
    (this.args.options ?? this.args.items ?? [])[0]?.value;
  @tracked internalValues = this.args.defaultValues ?? [];
  name = `${guidFor(this)}-fc`;
  get options(): FilterChipOption[] {
    return firstDefined(this.args.options, this.args.items) ?? [];
  }
  get value() {
    return this.args.value ?? this.internalValue;
  }
  get values(): string[] {
    return this.args.values ?? this.internalValues;
  }
  pick = (option: FilterChipOption) => {
    if (this.args.multiple) {
      let next = this.values.includes(option.value)
        ? this.values.filter((v) => v !== option.value)
        : [...this.values, option.value];
      if (this.args.values === undefined) {
        this.internalValues = next;
      }
      emit([this.args.onValuesChange, this.args.onSelectionChange], next);
      return;
    }
    if (this.args.value === undefined) {
      this.internalValue = option.value;
    }
    emit([this.args.onValueChange, this.args.onChange], option.value);
  };
  isActive = (option: FilterChipOption) =>
    this.args.multiple
      ? this.values.includes(option.value)
      : this.value === option.value;
  get moreLabel() {
    return this.args.moreLabel ?? 'more filters';
  }
  get few() {
    return this.args.display === 'few';
  }
  private shown = (option: FilterChipOption, index: number) =>
    index < (this.args.visibleCount ?? 3) || this.isActive(option);
  get visibleOptions(): FilterChipOption[] {
    return this.few ? this.options.filter(this.shown) : this.options;
  }
  get hiddenOptions(): FilterChipOption[] {
    return this.few
      ? this.options.filter((o, i) => !this.shown(o, i))
      : [];
  }
  get overflowItems(): MenuEntry[] {
    return this.hiddenOptions.map((option) =>
      this.args.multiple
        ? {
            kind: 'toggle' as const,
            label: option.label,
            checked: false,
            onSelect: () => this.pick(option),
          }
        : {
            kind: 'radio' as const,
            group: this.name,
            label: option.label,
            checked: false,
            onSelect: () => this.pick(option),
          },
    );
  }
  // `option.hue` is caller data reaching an inline style — validated against
  // the kit allowlist so it cannot carry its own declarations.
  dotStyle = (option: FilterChipOption) => cssStyle('background', option.hue);
  get showCounts() {
    return (
      this.args.reserveCounts ??
      this.options.some((o) => o.count !== undefined)
    );
  }
  get rowStyle() {
    return htmlSafe(
      `--pretui-filterchip-count-ch: ${cssNumber(this.args.countDigits, 1, 12) ?? 2}`,
    );
  }
  <template>
    <div
      class='pretui-filterchips'
      role={{if @multiple 'group' 'radiogroup'}}
      aria-label={{@label}}
      style={{this.rowStyle}}
      data-display={{if this.few 'few'}}
      data-test-pretui-filter-chips
      ...attributes
    >
      {{#each this.visibleOptions as |option|}}
        <label
          class='pretui-filterchip'
          data-state={{if (this.isActive option) 'active'}}
        >
          {{#if @multiple}}
            <input
              type='checkbox'
              class='pretui-filterchip-input'
              value={{option.value}}
              checked={{this.isActive option}}
              {{on 'change' (fn this.pick option)}}
            />
          {{else}}
            <input
              type='radio'
              class='pretui-filterchip-input'
              name={{this.name}}
              value={{option.value}}
              checked={{this.isActive option}}
              {{on 'change' (fn this.pick option)}}
            />
          {{/if}}
          {{#if option.hue}}<span class='pretui-filterdot' style={{this.dotStyle option}}></span>{{/if}}
          {{option.label}}
          {{#if this.showCounts}}<span class='pretui-filterchip-count'>{{option.count}}</span>{{/if}}
        </label>
      {{/each}}
      {{#if this.hiddenOptions.length}}
        <Menu @items={{this.overflowItems}} @label={{if @label @label this.moreLabel}}>
          <:trigger as |_open toggle|>
            {{! a raw button, not Button: it wears the chip's own face and
                height, which Button's variants don't draw }}
            <button
              type='button'
              class='pretui-filterchip pretui-filterchip-more'
              aria-label='+{{this.hiddenOptions.length}} {{this.moreLabel}}'
              {{on 'click' toggle}}
              data-test-pretui-filter-chips-more
            >+{{this.hiddenOptions.length}}<svg
                width='8'
                height='8'
                viewBox='0 0 8 8'
                aria-hidden='true'
              ><path
                  d='M1.5 3l2.5 2.5L6.5 3'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='1.25'
                  stroke-linecap='round'
                /></svg></button>
          </:trigger>
        </Menu>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-filterchips {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          flex-wrap: wrap;
        }
        .pretui-filterchips[data-display='few'] {
          flex-wrap: nowrap;
        }
        .pretui-filterchip-more {
          gap: var(--boxel-sp-5xs);
        }
        .pretui-filterchip {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          position: relative;
          /* --pretui-row-h: the row height a LayoutControl sets; --pretui-filterchip-h:
             opt-in height knob, read after it */
          height: var(--_chip-h);
          /* a full pill at any height */
          --_chip-h: var(
            --pretui-row-h,
            var(--pretui-filterchip-h, 1.625rem)
          );
          border-radius: calc(var(--_chip-h) / 2);
          padding: 0 calc(0.375rem * var(--pretui-capsule-base, 1.35) + 0.8125rem * var(--pretui-radius-encroach, 0.35));
          border: 0;
          font: inherit;
          font-size: var(--text-ui, 0.75rem);
          font-weight: 500;
          letter-spacing: inherit;
          color: var(--muted-foreground);
          background: none;
          cursor: pointer;
          flex: none;
          white-space: nowrap;
          transition: background 200ms var(--pretui-ease-snap, ease), box-shadow 200ms var(--pretui-ease-snap, ease), color 200ms;
        }
        .pretui-filterchip-input {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: 0;
          opacity: 0;
          pointer-events: none;
        }
        .pretui-filterchip:has(.pretui-filterchip-input:focus-visible) {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-filterchip:hover {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-filterchip[data-state='active'] {
          background: var(--card);
          color: var(--foreground);
          /* selection is never colour alone: the raised card face + control
             shadow survive greyscale, and no width changes, so the row never
             re-flows on a pick */
          box-shadow: var(--pretui-shadow-control, 0 0 0 1px var(--border));
        }
        .pretui-filterdot {
          width: 0.375rem;
          height: 0.375rem;
          border-radius: 50%;
          flex: none;
        }
        /* The slot is rendered whether or not the number has arrived, and it is
           at least `--pretui-filterchip-count-ch` digits wide, so a row of
           chips does not re-flow as each count resolves. */
        .pretui-filterchip-count {
          border-radius: 0.25rem;
          padding: 0 0.25rem;
          min-width: calc(var(--pretui-filterchip-count-ch, 2) * 1ch);
          text-align: center;
          font-size: 0.65625rem;
          font-variant-numeric: tabular-nums;
          color: var(--ink-3, var(--boxel-400));
        }
        .pretui-filterchip[data-state='active'] .pretui-filterchip-count {
          background: var(--inset, var(--boxel-100));
          color: var(--muted-foreground);
        }
        @media (any-pointer: coarse) {
          .pretui-filterchip {
            min-height: 2.125rem;
          }
        }
      }
    </style>
  </template>
}
