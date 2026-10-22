// Pretui — ColorArea: a two-channel colour plane painted from the colour engine.
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import { on } from '@ember/modifier';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { dragsSurface } from '../internal/design-tools';
import type { SurfaceFrame } from '../internal/design-tools';
import { areaColorAt, paintArea, areaPosition, channelValueText, clamp, cssFor, inkOn, round, spaceSpec, stepFor, withAlpha } from '../color-engine';
import type { ColorValue, GamutId } from '../color-engine';

// ── Modifiers ────────────────────────────────────────────────────────────

/**
 * Paints the area canvas. The engine returns raw RGBA; this puts it on the
 * canvas at native resolution and lets CSS scale it up smoothly.
 *
 * Owning the paint in a modifier is what makes it legal: it re-runs when its
 * arguments change, never on a loop, and there is nothing to tear down
 * because nothing outlives the call. Contrast upstream, which posts to a
 * Worker built from an object URL — a lifetime that must be terminated and a
 * URL that must be revoked, both of which the realm's no-unowned-timers law
 * exists to prevent people from forgetting.
 */
export const paintsArea = modifier(
  (
    element: HTMLCanvasElement,
    [base, gamut, size]: [ColorValue, GamutId, number],
  ) => {
    let context = element.getContext('2d');
    if (!context) {
      return;
    }
    let paint = paintArea(base, gamut, size);
    if (element.width !== paint.size) {
      element.width = paint.size;
    }
    if (element.height !== paint.size) {
      element.height = paint.size;
    }
    // `createImageData` + `set` rather than `new ImageData(buffer, …)`: the
    // constructor overload is typed against a specific ArrayBuffer variance
    // that a plain Uint8ClampedArray does not satisfy under the realm's TS
    // lib, and this path allocates the same amount.
    let image = context.createImageData(paint.size, paint.size);
    image.data.set(paint.data);
    context.putImageData(image, 0, 0);
  },
);

// ── ColorArea ────────────────────────────────────────────────────────────

/**
 * The 2D plane. Which two channels it shows depends on the space: saturation
 * × value for the RGB-ish models, chroma × lightness for OKLCH/P3/Rec.2020,
 * a × b for OKLab. The third channel is the slider beside it.
 *
 * **Accessibility model.** A 2D control cannot be one `role="slider"` — a
 * single `aria-valuenow` cannot express two axes, which is the flaw in both
 * sources (upstream sets none at all; figui3 sets `aria-valuenow` to the
 * vertical axis only and papers over it with `aria-valuetext`). This renders
 * TWO real range inputs, one per axis, each with its own label and spoken
 * value. Both are transparent and cover the plane, so either tab stop drives
 * both axes from the keyboard, and the focus ring is drawn on the thumb.
 */
export interface ColorAreaSignature {
  Args: {
    color: ColorValue;
    gamut: GamutId;
    /** Paint resolution. 96 is ~10ms; 128 is ~36ms and visibly crisper on
     *  a large picker. */
    resolution?: number;
    disabled?: boolean;
    onChange: (color: ColorValue) => void;
    onCommit?: () => void;
  };
  Element: HTMLDivElement;
}

export class ColorArea extends Component<ColorAreaSignature> {
  get spec() {
    return spaceSpec(this.args.color.space);
  }
  get modelSpec() {
    return spaceSpec(this.spec.area.model);
  }
  get xChannel() {
    return this.modelSpec.channels[this.spec.area.x]!;
  }
  get yChannel() {
    return this.modelSpec.channels[this.spec.area.y]!;
  }
  get position() {
    return areaPosition(this.args.color);
  }
  get resolution() {
    return clamp(this.args.resolution ?? 96, 16, 256);
  }
  get thumbStyle() {
    let point = this.position;
    return cssStyleFrom([
      '--pretui-area-x: ' + round(clamp(point.x, 0, 1) * 100, 3) + '%',
      '--pretui-area-y: ' + round(clamp(point.y, 0, 1) * 100, 3) + '%',
      cssDeclaration(
        '--pretui-area-thumb-color',
        cssFor(withAlpha(this.args.color, 1)),
      ),
      // `inkOn` returns the literal 'black' | 'white' — a closed enum, not
      // caller text — but it costs nothing to send it through the guard too.
      cssDeclaration('--pretui-area-thumb-ink', inkOn(this.args.color)),
    ]);
  }
  /** Display value on each axis, for the range inputs. */
  get xValue() {
    let min = this.xChannel.min;
    return round(min + (this.xChannel.max - min) * this.position.x, 4);
  }
  get yValue() {
    let min = this.yChannel.min;
    return round(min + (this.yChannel.max - min) * (1 - this.position.y), 4);
  }
  get xValueText() {
    return channelValueText(this.modelSpec, this.spec.area.x, this.xValue);
  }
  get yValueText() {
    return channelValueText(this.modelSpec, this.spec.area.y, this.yValue);
  }
  get groupLabel() {
    return `${this.xChannel.label} and ${this.yChannel.label}`;
  }

  private emit(fx: number, fy: number) {
    this.args.onChange(areaColorAt(this.args.color, fx, fy));
  }

  /** Pointer handling is `dragsSurface` from the design-tools port — one
   *  drag primitive for the kit, not a second one here. It gives pointer
   *  capture (so a drag survives leaving the plane), touch, and the
   *  press-origin element, all of which a hand-rolled area picker gets
   *  wrong. */
  handleDrag = (frame: SurfaceFrame) => {
    if (this.args.disabled) {
      return;
    }
    this.emit(frame.nx, frame.ny);
    if (frame.phase === 'end') {
      this.args.onCommit?.();
    }
  };

  handleX = (event: Event) => {
    let input = event.target as HTMLInputElement;
    let span = this.xChannel.max - this.xChannel.min;
    let fx = span === 0 ? 0 : (Number(input.value) - this.xChannel.min) / span;
    this.emit(fx, this.position.y);
  };

  handleY = (event: Event) => {
    let input = event.target as HTMLInputElement;
    let span = this.yChannel.max - this.yChannel.min;
    let fy =
      span === 0 ? 0 : 1 - (Number(input.value) - this.yChannel.min) / span;
    this.emit(this.position.x, fy);
  };

  /**
   * Both inputs get the SAME handler, so whichever axis has focus can drive
   * either one. Without this, tabbing to the vertical axis and pressing
   * ArrowLeft would do nothing — a keyboard user would have to know which
   * invisible input they were on, which is exactly the kind of thing that
   * makes a "keyboard accessible" widget unusable in practice.
   */
  handleKey = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    let key = event.key;
    let horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    let vertical = key === 'ArrowUp' || key === 'ArrowDown';
    let corner = key === 'Home' || key === 'End';
    if (!horizontal && !vertical && !corner) {
      return;
    }
    event.preventDefault();
    let point = this.position;

    if (corner) {
      // Home/End move along the axis the focused input owns, which is what
      // a screen-reader user is told they are on. Neither source implements
      // Home/End on the area at all.
      let isY = (event.target as HTMLElement).classList.contains(
        'pretui-area-axis-y',
      );
      if (isY) {
        this.emit(point.x, key === 'Home' ? 1 : 0);
      } else {
        this.emit(key === 'Home' ? 0 : 1, point.y);
      }
      this.args.onCommit?.();
      return;
    }

    let channel = horizontal ? this.xChannel : this.yChannel;
    let span = channel.max - channel.min;
    let step = stepFor(channel, {
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
    let fraction = span === 0 ? 0 : step / span;
    let direction = key === 'ArrowRight' || key === 'ArrowUp' ? 1 : -1;

    if (horizontal) {
      this.emit(clamp(point.x + fraction * direction, 0, 1), point.y);
    } else {
      // y is inverted: screen-down is channel-down.
      this.emit(point.x, clamp(point.y - fraction * direction, 0, 1));
    }
    this.args.onCommit?.();
  };

  <template>
    <div
      class='pretui-area'
      role='group'
      aria-label={{this.groupLabel}}
      style={{this.thumbStyle}}
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-color-area
      {{dragsSurface this.handleDrag @disabled}}
      ...attributes
    >
      <canvas
        class='pretui-area-canvas'
        aria-hidden='true'
        {{paintsArea @color @gamut this.resolution}}
      ></canvas>
      <span class='pretui-area-thumb' aria-hidden='true'></span>
      <input
        type='range'
        class='pretui-area-axis pretui-area-axis-x'
        aria-label={{this.xChannel.label}}
        aria-valuetext={{this.xValueText}}
        min={{this.xChannel.min}}
        max={{this.xChannel.max}}
        step={{this.xChannel.step}}
        value={{this.xValue}}
        disabled={{@disabled}}
        {{on 'input' this.handleX}}
        {{on 'keydown' this.handleKey}}
      />
      <input
        type='range'
        class='pretui-area-axis pretui-area-axis-y'
        aria-label={{this.yChannel.label}}
        aria-valuetext={{this.yValueText}}
        min={{this.yChannel.min}}
        max={{this.yChannel.max}}
        step={{this.yChannel.step}}
        value={{this.yValue}}
        disabled={{@disabled}}
        {{on 'input' this.handleY}}
        {{on 'keydown' this.handleKey}}
      />
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-area {
          position: relative;
          display: block;
          width: 100%;
          aspect-ratio: var(--pretui-area-ratio, 4 / 3);
          border-radius: calc(var(--radius) / 1.6);
          overflow: hidden;
          box-shadow: inset 0 0 0 1px
            color-mix(in oklch, var(--foreground) 16%, transparent);
          touch-action: none;
          cursor: crosshair;
          /* the faded out-of-gamut pixels are drawn OVER this, so the plate
             colour is what "unreachable" reads against */
          background: var(--card);
        }
        .pretui-area[data-disabled='true'] {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .pretui-area-canvas {
          display: block;
          width: 100%;
          height: 100%;
          /* the canvas is painted at 96²–128² and scaled up; smooth is
             correct here — the plane genuinely is continuous */
          image-rendering: auto;
        }
        .pretui-area-thumb {
          position: absolute;
          left: var(--pretui-area-x, 50%);
          top: var(--pretui-area-y, 50%);
          width: var(--pretui-area-thumb-size, 16px);
          height: var(--pretui-area-thumb-size, 16px);
          margin-left: calc(var(--pretui-area-thumb-size, 16px) / -2);
          margin-top: calc(var(--pretui-area-thumb-size, 16px) / -2);
          border-radius: 50%;
          background: var(--pretui-area-thumb-color, transparent);
          box-shadow:
            0 0 0 2px var(--pretui-area-thumb-ink, var(--boxel-light)),
            0 0 0 3.5px rgb(0 0 0 / 0.35);
          pointer-events: none;
          /* `raised` is the tier for layering INSIDE one component's own box:
             the thumb over its canvas. It must never compete with anything
             outside the picker. */
          z-index: var(--pretui-z-raised, 1);
        }
        /* focus lands on an invisible input; the ring belongs on the thumb.
           The thumb is absolutely positioned, so the doubled transparent
           outline cannot move anything; it exists only for forced-colors
           mode, which paints no box-shadow and would otherwise leave the
           plane with no focus indicator at all. */
        .pretui-area:has(.pretui-area-axis:focus-visible) .pretui-area-thumb {
          outline: 2px solid transparent;
          outline-offset: 2px;
          box-shadow:
            0 0 0 2px var(--pretui-area-thumb-ink, var(--boxel-light)),
            0 0 0 4px var(--ring);
        }
        .pretui-area-axis {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          margin: 0;
          opacity: 0;
          appearance: none;
          -webkit-appearance: none;
          background: transparent;
          /* the drag is owned by the surface modifier; the inputs exist for
             the keyboard and the accessibility tree only */
          pointer-events: none;
        }
      }
    </style>
  </template>
}
