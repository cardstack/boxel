// Pretui — Joystick: a two-axis pad for a point inside a box.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { Handle } from './handle';
import { ScrubInput } from './scrub-input';
import { clampRange, dragsSurface, roundTo } from '../internal/design-tools';
import type { SurfaceFrame } from '../internal/design-tools';

// ═══════════════════════════════════════════════════════════════════════
// Joystick
// ═══════════════════════════════════════════════════════════════════════

export interface Point2 {
  /** 0–100 */
  x: number;
  /** 0–100 */
  y: number;
}

export interface JoystickSignature {
  Args: {
    /** position as percentages, 0–100 on each axis */
    value?: Point2;
    defaultValue?: Point2;
    /** 'screen' (default) puts 0,0 at the TOP left — the CSS frame.
     * 'math' puts 0,0 at the BOTTOM left, and only the reported `y`
     * changes; the handle is drawn in screen space either way. */
    coordinates?: 'screen' | 'math';
    /** percent moved by one arrow press (default 1) */
    step?: number;
    /** decimal places in the paired fields (default 0) */
    precision?: number;
    /** render the X/Y spinbuttons under the pad (default true — they are
     * the exact-value path, and the reason the pad can be a plain grip) */
    fields?: boolean;
    /** four edge labels, in order: left, right, top, bottom */
    axisLabels?: [string, string, string, string];
    /** the position the reset control returns to (default 50/50) */
    origin?: Point2;
    label?: string;
    disabled?: boolean;
    onInput?: (value: Point2) => void;
    onChange?: (value: Point2) => void;
  };
  Element: HTMLDivElement;
}

export class Joystick extends Component<JoystickSignature> {
  @tracked private internal: Point2 =
    this.args.defaultValue ?? { x: 50, y: 50 };

  get point(): Point2 {
    return this.args.value ?? this.internal;
  }
  get step(): number {
    return this.args.step ?? 1;
  }
  get precision(): number {
    return this.args.precision ?? 0;
  }
  get showFields(): boolean {
    return this.args.fields ?? true;
  }
  get origin(): Point2 {
    return this.args.origin ?? { x: 50, y: 50 };
  }
  get label(): string {
    return this.args.label ?? 'Position';
  }
  /** The y the CALLER sees. In 'math' coordinates that is flipped from the
   * screen y the handle is drawn at. */
  get reportedY(): number {
    return this.args.coordinates === 'math' ? 100 - this.point.y : this.point.y;
  }
  get isDefault(): boolean {
    return (
      roundTo(this.point.x, 2) === roundTo(this.origin.x, 2) &&
      roundTo(this.point.y, 2) === roundTo(this.origin.y, 2)
    );
  }
  get valueText(): string {
    return (
      roundTo(this.point.x, this.precision) +
      '%, ' +
      roundTo(this.reportedY, this.precision) +
      '%'
    );
  }
  get guideStyle() {
    let x = clampRange(Number(this.point.x) || 0, 0, 100);
    let y = clampRange(Number(this.point.y) || 0, 0, 100);
    return htmlSafe(
      '--pretui-joy-x: ' + roundTo(x, 3) + '%; --pretui-joy-y: ' + roundTo(y, 3) + '%',
    );
  }
  get axisLabels(): [string, string, string, string] {
    return this.args.axisLabels ?? ['', '', '', ''];
  }
  get hasAxisLabels(): boolean {
    return this.axisLabels.some((text) => text !== '');
  }
  /* Numeric path segments (`{{this.axisLabels.0}}`) are invalid in Glimmer —
     `boxel parse` accepts them and the realm transpiler rejects the whole
     module, so each edge is its own getter. */
  get axisLeft(): string {
    return this.axisLabels[0] ?? '';
  }
  get axisRight(): string {
    return this.axisLabels[1] ?? '';
  }
  get axisTop(): string {
    return this.axisLabels[2] ?? '';
  }
  get axisBottom(): string {
    return this.axisLabels[3] ?? '';
  }

  private commit(next: Point2, done: boolean) {
    let value: Point2 = {
      x: roundTo(clampRange(next.x, 0, 100), 4),
      y: roundTo(clampRange(next.y, 0, 100), 4),
    };
    if (this.args.value === undefined) {
      this.internal = value;
    }
    let reported: Point2 = {
      x: value.x,
      y: this.args.coordinates === 'math' ? 100 - value.y : value.y,
    };
    this.args.onInput?.(reported);
    if (done) {
      this.args.onChange?.(reported);
    }
  }

  handleDrag = (part: SurfaceFrame) => {
    if (this.args.disabled) {
      return;
    }
    if (part.phase === 'end') {
      this.args.onChange?.({ x: this.point.x, y: this.reportedY });
      return;
    }
    // Shift constrains to the dominant axis, the way every canvas tool
    // behaves — figui3 has no axis lock on the joystick at all.
    let next = { x: part.nx * 100, y: part.ny * 100 };
    if (part.shift) {
      let dx = Math.abs(next.x - this.point.x);
      let dy = Math.abs(next.y - this.point.y);
      if (dx > dy) {
        next.y = this.point.y;
      } else {
        next.x = this.point.x;
      }
    }
    this.commit(next, false);
  };

  // Handle has already scaled dx/dy by @step and the modifier keys
  handleNudge = (dx: number, dy: number) => {
    if (this.args.disabled) {
      return;
    }
    if (dx === -Infinity) {
      this.commit({ x: 0, y: this.point.y }, true);
      return;
    }
    if (dx === Infinity) {
      this.commit({ x: 100, y: this.point.y }, true);
      return;
    }
    this.commit(
      { x: this.point.x + dx, y: this.point.y + dy },
      true,
    );
  };

  setX = (value: number | null) => {
    if (value !== null) {
      this.commit({ x: value, y: this.point.y }, true);
    }
  };
  setY = (value: number | null) => {
    if (value === null) {
      return;
    }
    let screenY = this.args.coordinates === 'math' ? 100 - value : value;
    this.commit({ x: this.point.x, y: screenY }, true);
  };
  get resetDisabled(): boolean {
    return this.args.disabled === true || this.isDefault;
  }
  reset = () => {
    if (this.resetDisabled) {
      return;
    }
    this.commit({ x: this.origin.x, y: this.origin.y }, true);
  };
  <template>
    <div
      class='pretui-joystick'
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-joystick
      ...attributes
    >
      <div class='pretui-joystick-frame'>
        <div
          class='pretui-joystick-pad'
          style={{this.guideStyle}}
          {{dragsSurface this.handleDrag @disabled}}
          data-test-pretui-joystick-pad
        >
          <span class='pretui-joystick-guide' data-axis='x'></span>
          <span class='pretui-joystick-guide' data-axis='y'></span>
          <Handle
            @x={{this.point.x}}
            @y={{this.point.y}}
            @step={{this.step}}
            @label={{this.label}}
            @valueText={{this.valueText}}
            @disabled={{@disabled}}
            @onNudge={{this.handleNudge}}
          />
        </div>
        {{#if this.hasAxisLabels}}
          <span class='pretui-joystick-axis' data-edge='left' aria-hidden='true'>{{this.axisLeft}}</span>
          <span class='pretui-joystick-axis' data-edge='right' aria-hidden='true'>{{this.axisRight}}</span>
          <span class='pretui-joystick-axis' data-edge='top' aria-hidden='true'>{{this.axisTop}}</span>
          <span class='pretui-joystick-axis' data-edge='bottom' aria-hidden='true'>{{this.axisBottom}}</span>
        {{/if}}
      </div>

      {{#if this.showFields}}
        <div class='pretui-joystick-fields'>
          <ScrubInput
            @label='X'
            @grip='X'
            @unitPosition='prefix'
            @value={{this.point.x}}
            @min={{0}}
            @max={{100}}
            @step={{this.step}}
            @precision={{this.precision}}
            @disabled={{@disabled}}
            @onChange={{this.setX}}
          />
          <ScrubInput
            @label='Y'
            @grip='Y'
            @unitPosition='prefix'
            @value={{this.reportedY}}
            @min={{0}}
            @max={{100}}
            @step={{this.step}}
            @precision={{this.precision}}
            @disabled={{@disabled}}
            @onChange={{this.setY}}
          />
          <button
            type='button'
            class='pretui-joystick-reset'
            aria-label='Reset position to default'
            aria-disabled={{if this.resetDisabled 'true'}}
            {{on 'click' this.reset}}
            data-test-pretui-joystick-reset
          >Reset</button>
        </div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-joystick {
          display: grid;
          gap: var(--space-3, 8px);
          min-width: 0;
        }
        .pretui-joystick[data-disabled='true'] {
          opacity: 0.5;
        }
        .pretui-joystick-frame {
          position: relative;
          padding: var(--pretui-joy-inset, 0);
        }
        .pretui-joystick-pad {
          position: relative;
          width: 100%;
          aspect-ratio: var(--pretui-joy-ratio, 1 / 1);
          border-radius: var(--radius);
          background: var(--field, var(--boxel-light));
          box-shadow: inset 0 0 0 1px var(--input);
          touch-action: none;
          overflow: hidden;
        }
        /* Guides: two hairlines that follow the handle. A design tool reads
           alignment off these, which is why they are not decoration. */
        .pretui-joystick-guide {
          position: absolute;
          background: color-mix(in oklch, var(--primary) 40%, transparent);
        }
        .pretui-joystick-guide[data-axis='x'] {
          top: 0;
          bottom: 0;
          left: var(--pretui-joy-x, 50%);
          width: 1px;
        }
        .pretui-joystick-guide[data-axis='y'] {
          left: 0;
          right: 0;
          top: var(--pretui-joy-y, 50%);
          height: 1px;
        }
        .pretui-joystick-axis {
          position: absolute;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          color: var(--ink-3, var(--boxel-400));
        }
        .pretui-joystick-axis[data-edge='left'] {
          top: 50%;
          left: 4px;
          translate: 0 -50%;
        }
        .pretui-joystick-axis[data-edge='right'] {
          top: 50%;
          right: 4px;
          translate: 0 -50%;
        }
        .pretui-joystick-axis[data-edge='top'] {
          top: 4px;
          left: 50%;
          translate: -50% 0;
        }
        .pretui-joystick-axis[data-edge='bottom'] {
          bottom: 4px;
          left: 50%;
          translate: -50% 0;
        }
        .pretui-joystick-fields {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
          gap: var(--space-2, 6px);
          align-items: center;
        }
        .pretui-joystick-reset {
          height: var(--control-h, 28px);
          padding-inline: 8px;
          border: 0;
          border-radius: var(--radius);
          background: transparent;
          color: var(--muted-foreground);
          font-size: var(--text-ui-xs, 11px);
          cursor: pointer;
        }
        .pretui-joystick-reset:hover {
          background: var(--hover, rgb(0 0 0 / 0.05));
          color: var(--foreground);
        }
        .pretui-joystick-reset[aria-disabled='true'] {
          opacity: 0.35;
          cursor: default;
        }
        .pretui-joystick-reset:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* Narrow panes drop the reset word to a glyph-width button and stack
           the fields. Unnamed container query only. */
        @container (max-width: 200px) {
          .pretui-joystick-fields {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          }
          .pretui-joystick-reset {
            grid-column: 1 / -1;
          }
        }
      }
    </style>
  </template>
}
