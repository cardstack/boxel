// Pretui — OriginGrid: a nine-anchor picker for a transform origin, with free placement between anchors.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { guidFor } from '@ember/object/internals';
import { Handle } from './handle';
import { ScrubInput } from './scrub-input';
import { clampRange, dragsSurface, roundTo, snapToPoints } from '../internal/design-tools';
import type { SurfaceFrame } from '../internal/design-tools';
import { rovingTabindex } from '../focus';
import type { Point2 } from './joystick';

// ═══════════════════════════════════════════════════════════════════════
// OriginGrid
// ═══════════════════════════════════════════════════════════════════════

/** The nine anchors, in reading order. */
export const ORIGIN_ANCHORS: readonly Point2[] = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 100, y: 0 },
  { x: 0, y: 50 },
  { x: 50, y: 50 },
  { x: 100, y: 50 },
  { x: 0, y: 100 },
  { x: 50, y: 100 },
  { x: 100, y: 100 },
];

export const ORIGIN_ANCHOR_NAMES: readonly string[] = [
  'Top left',
  'Top centre',
  'Top right',
  'Centre left',
  'Centre',
  'Centre right',
  'Bottom left',
  'Bottom centre',
  'Bottom right',
];

/** Snap targets along one axis: the three anchors plus the thirds figui3
 * also offers, so a free drag can still land on something meaningful. */
export const ORIGIN_SNAPS: readonly number[] = [
  0,
  100 / 6,
  100 / 3,
  50,
  (2 * 100) / 3,
  (5 * 100) / 6,
  100,
];

/** The index of the anchor a position sits exactly on, or -1. */
export function anchorIndexFor(point: Point2, tolerance = 0.5): number {
  return ORIGIN_ANCHORS.findIndex(
    (anchor) =>
      Math.abs(anchor.x - point.x) <= tolerance &&
      Math.abs(anchor.y - point.y) <= tolerance,
  );
}

interface OriginCell {
  index: number;
  name: string;
  x: number;
  y: number;
  selected: boolean;
  tabIndex: number;
}

export interface OriginGridSignature {
  Args: {
    /** anchor as percentages, 0–100. Defaults to the centre. */
    value?: Point2;
    defaultValue?: Point2;
    /** allow free positions between the anchors by dragging (default true).
     * Named `freeform` rather than `drag`: the realm's
     * `no-passed-in-event-handlers` rule reserves DOM-event names. */
    freeform?: boolean;
    /** render the X/Y spinbuttons (default false — most panels only need
     * the nine anchors) */
    fields?: boolean;
    /** decimal places in the fields (default 0) */
    precision?: number;
    label?: string;
    disabled?: boolean;
    onChange?: (value: Point2) => void;
  };
  Element: HTMLDivElement;
}

/**
 * The nine-point anchor picker (transform-origin, alignment, gravity).
 *
 * The nine anchors are a real `role='radiogroup'`: one tab stop, arrow keys
 * moving in TWO dimensions across the grid (Left/Right within a row,
 * Up/Down between rows), Home/End to the first and last anchor, and a
 * selected anchor announced by name — "Bottom right", not "66%, 100%".
 * figui3 renders the nine cells as `<span>`s and gives them no keyboard at
 * all; only its handle is reachable.
 *
 * Free positioning is an ENHANCEMENT on top, not the primary contract. When
 * the value is not on an anchor, no radio is checked and the state reads as
 * the word "Custom" plus the exact numbers — a text channel.
 */
export class OriginGrid extends Component<OriginGridSignature> {
  @tracked private internal: Point2 =
    this.args.defaultValue ?? { x: 50, y: 50 };
  /** which cell holds the group's single tab stop */
  @tracked private focusIndex = 4;
  private guid = guidFor(this);

  get point(): Point2 {
    return this.args.value ?? this.internal;
  }
  get precision(): number {
    return this.args.precision ?? 0;
  }
  get dragEnabled(): boolean {
    return (this.args.freeform ?? true) && !this.args.disabled;
  }
  get label(): string {
    return this.args.label ?? 'Origin';
  }
  get statusId(): string {
    return this.guid + '-origin-status';
  }
  get anchorIndex(): number {
    return anchorIndexFor(this.point);
  }
  get isCustom(): boolean {
    return this.anchorIndex === -1;
  }
  get statusText(): string {
    if (!this.isCustom) {
      return ORIGIN_ANCHOR_NAMES[this.anchorIndex] ?? '';
    }
    return (
      'Custom · ' +
      roundTo(this.point.x, this.precision) +
      '%, ' +
      roundTo(this.point.y, this.precision) +
      '%'
    );
  }
  get cells(): OriginCell[] {
    let selectedIndex = this.anchorIndex;
    // With no anchor selected the roving tab stop rests on the cell the
    // keyboard last visited, so Tab always reaches the group.
    let stop = selectedIndex === -1 ? this.focusIndex : selectedIndex;
    return ORIGIN_ANCHORS.map((anchor, index) => ({
      index,
      name: ORIGIN_ANCHOR_NAMES[index] ?? '',
      x: anchor.x,
      y: anchor.y,
      selected: index === selectedIndex,
      tabIndex: index === stop ? 0 : -1,
    }));
  }
  /** The handle's drawn position — the same dot-centre inset the CSS uses,
   * so the free handle lands exactly on an anchor dot when it snaps. */
  get customX(): number {
    return 100 / 6 + (clampRange(this.point.x, 0, 100) / 100) * (200 / 3);
  }
  get customY(): number {
    return 100 / 6 + (clampRange(this.point.y, 0, 100) / 100) * (200 / 3);
  }
  get dragDisabled(): boolean {
    return !this.dragEnabled;
  }
  get handleStyle() {
    // The handle rides the dot centres, so 0% sits on the first dot rather
    // than on the container edge: 1/6 … 5/6 of the box.
    let x = clampRange(Number(this.point.x) || 0, 0, 100);
    let y = clampRange(Number(this.point.y) || 0, 0, 100);
    return htmlSafe(
      '--pretui-origin-x: ' +
        roundTo(100 / 6 + (x / 100) * (200 / 3), 3) +
        '%; --pretui-origin-y: ' +
        roundTo(100 / 6 + (y / 100) * (200 / 3), 3) +
        '%',
    );
  }

  private commit(next: Point2) {
    let value: Point2 = {
      x: roundTo(clampRange(next.x, 0, 100), 4),
      y: roundTo(clampRange(next.y, 0, 100), 4),
    };
    if (this.args.value === undefined) {
      this.internal = value;
    }
    this.args.onChange?.(value);
  }

  selectCell = (index: number) => {
    if (this.args.disabled) {
      return;
    }
    let anchor = ORIGIN_ANCHORS[index];
    if (anchor) {
      this.focusIndex = index;
      this.commit({ x: anchor.x, y: anchor.y });
    }
  };

  handleCellKey = (index: number, event: Event) => {
    if (this.args.disabled) {
      return;
    }
    let key = (event as KeyboardEvent).key;
    let column = index % 3;
    let row = Math.floor(index / 3);
    let next = index;
    if (key === 'ArrowLeft') {
      next = row * 3 + Math.max(0, column - 1);
    } else if (key === 'ArrowRight') {
      next = row * 3 + Math.min(2, column + 1);
    } else if (key === 'ArrowUp') {
      next = Math.max(0, row - 1) * 3 + column;
    } else if (key === 'ArrowDown') {
      next = Math.min(2, row + 1) * 3 + column;
    } else if (key === 'Home') {
      next = 0;
    } else if (key === 'End') {
      next = 8;
    } else {
      return;
    }
    event.preventDefault();
    // Radio-group convention: moving focus also moves selection.
    this.selectCell(next);
    let cells = (event.currentTarget as HTMLElement)
      .closest('.pretui-origin')
      ?.querySelectorAll<HTMLElement>('.pretui-origin-cell');
    cells?.[next]?.focus();
  };

  handleDrag = (part: SurfaceFrame) => {
    if (!this.dragEnabled) {
      return;
    }
    // Map the pad box back onto 0–100, undoing the dot-centre inset.
    let toValue = (n: number) => ((n - 1 / 6) / (2 / 3)) * 100;
    let x = clampRange(toValue(part.rawX), 0, 100);
    let y = clampRange(toValue(part.rawY), 0, 100);
    // Alt suspends snapping — the escape hatch for a genuinely free value.
    if (!part.alt) {
      x = snapToPoints(x, ORIGIN_SNAPS, 6);
      y = snapToPoints(y, ORIGIN_SNAPS, 6);
    }
    this.commit({ x, y });
  };

  handleNudge = (dx: number, dy: number) => {
    if (dx === -Infinity) {
      this.commit({ x: 0, y: this.point.y });
      return;
    }
    if (dx === Infinity) {
      this.commit({ x: 100, y: this.point.y });
      return;
    }
    this.commit({ x: this.point.x + dx, y: this.point.y + dy });
  };

  setX = (value: number | null) => {
    if (value !== null) {
      this.commit({ x: value, y: this.point.y });
    }
  };
  setY = (value: number | null) => {
    if (value !== null) {
      this.commit({ x: this.point.x, y: value });
    }
  };
  <template>
    <div
      class='pretui-origin'
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-origin-grid
      ...attributes
    >
      <div
        class='pretui-origin-pad'
        style={{this.handleStyle}}
        {{dragsSurface this.handleDrag this.dragDisabled}}
        data-test-pretui-origin-pad
      >
        <div
          class='pretui-origin-cells'
          role='radiogroup'
          aria-label={{this.label}}
          aria-describedby={{this.statusId}}
        >
          {{#each this.cells key='index' as |cell|}}
            <OriginCellButton
              @cell={{cell}}
              @disabled={{@disabled}}
              @onSelect={{this.selectCell}}
              @onKey={{this.handleCellKey}}
            />
          {{/each}}
        </div>
        {{#if this.isCustom}}
          <Handle
            @x={{this.customX}}
            @y={{this.customY}}
            @label={{this.label}}
            @valueText={{this.statusText}}
            @disabled={{@disabled}}
            @onNudge={{this.handleNudge}}
          />
        {{/if}}
      </div>

      <p class='pretui-origin-status' id={{this.statusId}} data-test-pretui-origin-status>
        {{this.statusText}}
      </p>

      {{#if @fields}}
        <div class='pretui-origin-fields'>
          <ScrubInput
            @label='Origin X'
            @grip='X'
            @unitPosition='prefix'
            @value={{this.point.x}}
            @min={{0}}
            @max={{100}}
            @precision={{this.precision}}
            @disabled={{@disabled}}
            @onChange={{this.setX}}
          />
          <ScrubInput
            @label='Origin Y'
            @grip='Y'
            @unitPosition='prefix'
            @value={{this.point.y}}
            @min={{0}}
            @max={{100}}
            @precision={{this.precision}}
            @disabled={{@disabled}}
            @onChange={{this.setY}}
          />
        </div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-origin {
          display: grid;
          gap: var(--space-2, 6px);
          min-width: 0;
        }
        .pretui-origin[data-disabled='true'] {
          opacity: 0.5;
        }
        .pretui-origin-pad {
          position: relative;
          width: var(--pretui-origin-size, 76px);
          aspect-ratio: 1 / 1;
          border-radius: var(--radius);
          background: var(--field, var(--boxel-light));
          box-shadow: inset 0 0 0 1px var(--input);
          touch-action: none;
        }
        .pretui-origin-cells {
          position: absolute;
          inset: 0;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          grid-template-rows: repeat(3, 1fr);
        }
        .pretui-origin-status {
          margin: 0;
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
        }
        .pretui-origin-fields {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: var(--space-2, 6px);
        }
      }
    </style>
  </template>
}

// ── One anchor cell ──────────────────────────────────────────────────────
// Split out so each cell owns its own bound handlers: `(fn this.select i)`
// in the loop would allocate a fresh closure every render, which is the
// modifier-retracking trap documented in the workspace learnings.

interface OriginCellSignature {
  Args: {
    cell: OriginCell;
    disabled?: boolean;
    onSelect: (index: number) => void;
    onKey: (index: number, event: Event) => void;
  };
  Element: HTMLButtonElement;
}

class OriginCellButton extends Component<OriginCellSignature> {
  /** Roving tabindex is set as a PROPERTY by the shared modifier: the
   * `no-positive-tabindex` lint rule cannot statically verify a dynamic
   * template attribute and rejects it outright. */
  get isTabStop(): boolean {
    return this.args.cell.tabIndex === 0;
  }
  select = () => {
    this.args.onSelect(this.args.cell.index);
  };
  key = (event: Event) => {
    this.args.onKey(this.args.cell.index, event);
  };
  <template>
    <button
      type='button'
      class='pretui-origin-cell'
      role='radio'
      aria-checked={{if @cell.selected 'true' 'false'}}
      aria-label={{@cell.name}}
      aria-disabled={{if @disabled 'true'}}
      {{rovingTabindex this.isTabStop}}
      {{on 'click' this.select}}
      {{on 'keydown' this.key}}
      data-test-pretui-origin-cell
      ...attributes
    ></button>
    <style scoped>
      @layer PretComponent {
        /* A role='radio' element has children-presentational semantics, and
           the realm's require-presentational-children rule rejects any svg or
           component inside it — so the dot is a pseudo-element. */
        .pretui-origin-cell {
          position: relative;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: pointer;
        }
        .pretui-origin-cell::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 4px;
          translate: -50% -50%;
          border-radius: 50%;
          background: var(--ink-3, var(--boxel-400));
          transition: scale var(--pretui-dur-snap, 140ms)
            var(--pretui-ease-snap, ease);
        }
        .pretui-origin-cell:hover::before {
          background: var(--muted-foreground);
          scale: 1.4;
        }
        .pretui-origin-cell[aria-checked='true']::before {
          width: 9px;
          height: 9px;
          background: var(--primary);
          box-shadow: 0 0 0 2px
            color-mix(in oklch, var(--primary) 22%, transparent);
        }
        .pretui-origin-cell[aria-disabled='true'] {
          cursor: default;
        }
        .pretui-origin-cell:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
          border-radius: var(--radius-sm, 4px);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-origin-cell::before {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
