// Pretui — ColorPalette: a grid of swatches to choose from.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { cssStyleFrom } from '../pretui-css';
import { clamp, parseColor, round, toHex } from '../color-engine';
import { Swatch } from './swatch';

// ── ColorPalette ─────────────────────────────────────────────────────────

/**
 * A grid of swatches with one selection.
 *
 * Assessed against the field: the existing implementation was sound in
 * structure (roving ring, case-insensitive match) but had two real defects
 * and one gap. Both defects are fixed here rather than the component being
 * replaced — the grid itself did not need rebuilding.
 *
 *  * **Matching was string equality**, so `#FF0000`, `red`, `rgb(255 0 0)`
 *    and `oklch(62.8% 0.258 29.2)` were four different colours to it. It now
 *    compares CANONICAL forms, so a palette matches whatever notation the
 *    caller's value happens to be in.
 *  * **It had no keyboard model.** A grid of buttons is a lot of tab stops;
 *    it is now one tab stop with arrow-key traversal (APG grid pattern),
 *    Home/End for the ends.
 *  * The gap was the custom-colour affordance boxel-ui bundles. Rather than
 *    bundling one, `<:after>` yields a slot — compose with `ColorField` or
 *    `ColorPicker`. Law 7: anything visual a caller might replace is a slot.
 */
export interface ColorPaletteSignature {
  Args: {
    colors: string[];
    /** Optional label per colour, in the same order. */
    labels?: string[];
    value?: string;
    columns?: number;
    label?: string;
    onValueChange?: (color: string) => void;
  };
  Blocks: {
    /** Rendered after the grid — the natural home for a custom-colour
     *  trigger. */
    after: [];
  };
  Element: HTMLDivElement;
}

export class ColorPalette extends Component<ColorPaletteSignature> {
  @tracked focusIndex = 0;
  /** once the arrows move, the tab stop follows them instead of the selection */
  @tracked navigated = false;

  get canonicalValue(): string | null {
    let parsed = parseColor(this.args.value ?? '');
    return parsed ? toHex(parsed) : null;
  }

  get entries() {
    let current = this.canonicalValue;
    let selectedIndex = -1;
    let mapped = this.args.colors.map((color, index) => {
      let parsed = parseColor(color);
      let hex = parsed ? toHex(parsed) : null;
      let selected = current !== null && hex === current;
      if (selected && selectedIndex < 0) {
        selectedIndex = index;
      }
      return {
        color,
        index,
        selected,
        label: this.args.labels?.[index],
      };
    });
    // The tab stop follows the selection when there is one, so tabbing into
    // a palette lands on the current colour rather than always on the first.
    let stop =
      selectedIndex >= 0 && !this.navigated ? selectedIndex : this.focusIndex;
    return mapped.map((entry) => ({
      ...entry,
      tabbable: entry.index === stop,
    }));
  }

  get gridStyle() {
    let columns = this.args.columns;
    return columns
      ? cssStyleFrom([
          '--pretui-palette-columns: ' + round(clamp(columns, 1, 24), 0),
        ])
      : undefined;
  }

  pick = (color: string) => {
    this.navigated = false;
    this.args.onValueChange?.(color);
  };

  handleKey = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    let count = this.args.colors.length;
    if (count === 0) {
      return;
    }
    let columns = this.args.columns ?? 8;
    let swatch = event.currentTarget as HTMLElement;
    let swatches = Array.from(
      swatch.closest('.pretui-palette')?.querySelectorAll('.pretui-swatch') ?? [],
    );
    let current = swatches.indexOf(swatch);
    let next = current;
    switch (event.key) {
      case 'ArrowRight':
        next = current + 1;
        break;
      case 'ArrowLeft':
        next = current - 1;
        break;
      case 'ArrowDown':
        next = current + columns;
        break;
      case 'ArrowUp':
        next = current - columns;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.focusIndex = clamp(next, 0, count - 1);
    this.navigated = true;
    (swatches[this.focusIndex] as HTMLElement | undefined)?.focus();
  };

  <template>
    <div
      class='pretui-palette-shell'
      data-test-pretui-color-palette
      ...attributes
    >
      <div
        class='pretui-palette'
        role='group'
        aria-label={{if @label @label 'Colour palette'}}
        style={{this.gridStyle}}
      >
        {{#each this.entries key='color' as |entry|}}
          <Swatch
            @color={{entry.color}}
            @label={{entry.label}}
            @selected={{entry.selected}}
            @onSelect={{this.pick}}
            tabindex={{if entry.tabbable '0' '-1'}}
            {{on 'keydown' this.handleKey}}
          />
        {{/each}}
      </div>
      {{#if (has-block 'after')}}
        <div class='pretui-palette-after'>{{yield to='after'}}</div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-palette-shell {
          display: flex;
          flex-direction: column;
          gap: var(--space-3, 8px);
        }
        .pretui-palette {
          display: grid;
          grid-template-columns: repeat(
            var(--pretui-palette-columns, 8),
            minmax(0, 26px)
          );
          gap: var(--space-2, 5px);
          justify-content: start;
        }
        .pretui-palette-after {
          display: flex;
          align-items: center;
          gap: var(--space-2, 5px);
        }
        /* unnamed only — a named container query silently deletes every rule
           after it in this file */
        @container (max-width: 260px) {
          .pretui-palette {
            grid-template-columns: repeat(auto-fill, minmax(0, 26px));
          }
        }
      }
    </style>
  </template>
}
