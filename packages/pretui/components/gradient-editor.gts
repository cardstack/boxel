// Pretui — GradientEditor: an editor for linear, radial and conic gradients.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { Button } from './button';
import { Select } from './select';
import type { SelectOption } from './select';
import { ScrubInput } from './scrub-input';
import { dragsSurface } from '../internal/design-tools';
import type { SurfaceFrame } from '../internal/design-tools';
import { DEFAULT_GRADIENT, HUE_METHODS, INTERPOLATION_SPACES, clamp, cssFor, describeColor, gradientCss, nextStopId, parseColor, round, sampleGradientAt, sortedStops, toHex } from '../color-engine';
import type { GradientKind, GradientSpec, GradientStop, HueMethod, InterpolationSpace } from '../color-engine';
import { ColorStopEditor } from './color-stop-editor';

// ── GradientEditor ───────────────────────────────────────────────────────

/**
 * A gradient, edited.
 *
 * **The seam with the design-tools port.** Stop GEOMETRY — where a stop sits
 * on the bar, and dragging it there — belongs to `GradientInput` in the
 * design-tools work. Stop COLOUR, the interpolation space, and everything
 * about picking a colour belong here. The two meet at `<:bar>`: this
 * component owns the model and hands the bar block everything it needs to
 * render and mutate stop positions. If `GradientInput` lands, it goes in
 * that block and the built-in bar is never rendered; until then the built-in
 * bar is the default block's content, so the component is complete on its
 * own. Neither side has to wait for the other.
 */
export interface GradientBarApi {
  /** The gradient as CSS, safe to interpolate. */
  css: string;
  /** Stops in PAINT order (sorted by position); each keeps its own id. */
  stops: GradientStop[];
  selectedId: string | null;
  select: (id: string) => void;
  /** Move a stop to a new 0–100 position. */
  moveStop: (id: string, position: number) => void;
  /** Insert a stop, sampling the gradient's own colour at that point. */
  addStopAt: (position: number) => void;
  removeStop: (id: string) => void;
  /** True while removal would take the gradient below two stops. */
  atMinimum: boolean;
}

export interface GradientEditorSignature {
  Args: {
    value?: GradientSpec;
    defaultValue?: GradientSpec;
    disabled?: boolean;
    /** Hide the interpolation-space control. */
    lockInterpolation?: boolean;
    onValueChange?: (value: GradientSpec) => void;
  };
  Blocks: {
    /** Replace the built-in stop bar. See `GradientBarApi`. */
    bar: [GradientBarApi];
  };
  Element: HTMLDivElement;
}

const KIND_OPTIONS: SelectOption[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
  { value: 'conic', label: 'Conic' },
];

export class GradientEditor extends Component<GradientEditorSignature> {
  /** Monotonic, per instance. `Math.random()` and `Date.now()` are both
   *  forbidden in a realm (indexing determinism) and both would be the
   *  obvious way to make a stop id. */
  private idCounter = { value: 1000 };

  @tracked private internal: GradientSpec | null = null;
  @tracked selectedId: string | null = null;
  @tracked announcement = '';

  get spec(): GradientSpec {
    return this.args.value ?? this.internal ?? this.args.defaultValue ?? DEFAULT_GRADIENT;
  }
  get stops(): GradientStop[] {
    return sortedStops(this.spec);
  }
  get css(): string {
    return gradientCss(this.spec);
  }
  get previewStyle() {
    // ENGINE-CONSTRUCTED, and deliberately not passed through `cssValue`.
    // `gradientCss` concatenates numbers this component clamped and rounded,
    // keywords from three closed enums it owns, and stop colours that have
    // each already been through `cssFor` — there is provably no caller text
    // in the result. The shared allowlist would drop it: gradient functions
    // are not on its function list, and a multi-stop gradient exceeds its
    // 256-character cap.
    return cssStyleFrom(['--pretui-gradient-preview: ' + this.css]);
  }
  get atMinimum(): boolean {
    return this.spec.stops.length <= 2;
  }
  get canRemove(): boolean {
    return !this.atMinimum;
  }
  get isLinear(): boolean {
    return this.spec.kind === 'linear';
  }
  get isRadial(): boolean {
    return this.spec.kind === 'radial';
  }
  get hasAngle(): boolean {
    return this.spec.kind !== 'radial';
  }
  get hasCenter(): boolean {
    return this.spec.kind !== 'linear';
  }
  get interpolationOptions(): SelectOption[] {
    return INTERPOLATION_SPACES.map((entry) => ({
      value: entry.id,
      label: entry.label,
    }));
  }
  get hueMethodOptions(): SelectOption[] {
    return HUE_METHODS.map((entry) => ({
      value: entry.id,
      label: entry.label,
    }));
  }
  get isPolar(): boolean {
    return (
      INTERPOLATION_SPACES.find((entry) => entry.id === this.spec.interpolation)
        ?.polar ?? false
    );
  }
  get interpolationNote(): string {
    return (
      INTERPOLATION_SPACES.find((entry) => entry.id === this.spec.interpolation)
        ?.note ?? ''
    );
  }
  get selectedStop(): GradientStop | null {
    let id = this.selectedId ?? this.stops[0]?.id ?? null;
    return this.spec.stops.find((stop) => stop.id === id) ?? null;
  }

  get barApi(): GradientBarApi {
    return {
      css: this.css,
      stops: this.stops,
      selectedId: this.selectedStop?.id ?? null,
      select: this.select,
      moveStop: this.moveStop,
      addStopAt: this.addStopAt,
      removeStop: this.removeStop,
      atMinimum: this.atMinimum,
    };
  }

  private update(next: GradientSpec, announce = '') {
    if (this.args.value === undefined) {
      this.internal = next;
    }
    if (announce) {
      this.announcement = announce;
    }
    this.args.onValueChange?.(next);
  }

  private patch(part: Partial<GradientSpec>, announce = '') {
    this.update({ ...this.spec, ...part }, announce);
  }

  select = (id: string) => {
    this.selectedId = id;
  };

  moveStop = (id: string, position: number) => {
    let at = round(clamp(position, 0, 100), 2);
    this.patch({
      // Positions change; ORDER does not. Sorting on mutation is what makes
      // a stop lose its selection the moment it passes a neighbour, which is
      // the bug in figui3's bar-vs-list disagreement. Sorting happens only
      // in `sortedStops`, at paint time.
      stops: this.spec.stops.map((stop) =>
        stop.id === id ? { ...stop, position: at } : stop,
      ),
    });
  };

  setStopColor = (id: string, color: string) => {
    this.patch({
      stops: this.spec.stops.map((stop) =>
        stop.id === id ? { ...stop, color } : stop,
      ),
    });
  };

  addStopAt = (position: number) => {
    let at = round(clamp(position, 0, 100), 2);
    let sampled = sampleGradientAt(this.spec, at);
    let stop: GradientStop = {
      id: nextStopId(this.idCounter),
      position: at,
      color: toHex(sampled),
    };
    this.selectedId = stop.id;
    this.patch(
      { stops: [...this.spec.stops, stop] },
      `Stop added at ${round(at, 0)} percent, ${describeColor(sampled)}`,
    );
  };

  addStop = () => {
    // Insert into the WIDEST gap rather than always at 50%, so pressing the
    // button twice gives two useful stops instead of two stops on top of
    // each other (which is what upstream does).
    let ordered = this.stops;
    let widest = 0;
    let at = 50;
    for (let i = 0; i < ordered.length - 1; i++) {
      let gap = ordered[i + 1]!.position - ordered[i]!.position;
      if (gap > widest) {
        widest = gap;
        at = ordered[i]!.position + gap / 2;
      }
    }
    this.addStopAt(at);
  };

  removeStop = (id: string) => {
    if (this.atMinimum) {
      this.announcement = 'A gradient needs at least two stops';
      return;
    }
    let remaining = this.spec.stops.filter((stop) => stop.id !== id);
    if (this.selectedId === id) {
      this.selectedId = remaining[0]?.id ?? null;
    }
    this.patch({ stops: remaining }, `Stop removed, ${remaining.length} left`);
  };

  flip = () => {
    this.patch(
      {
        stops: this.spec.stops.map((stop) => ({
          ...stop,
          position: round(100 - stop.position, 2),
        })),
      },
      'Gradient flipped',
    );
  };

  rotate = () => {
    this.patch(
      { angle: (this.spec.angle + 90) % 360 },
      `Rotated to ${(this.spec.angle + 90) % 360} degrees`,
    );
  };

  distribute = () => {
    let ordered = this.stops;
    let count = ordered.length;
    if (count < 2) {
      return;
    }
    let byId = new Map(
      ordered.map((stop, index) => [
        stop.id,
        round((index / (count - 1)) * 100, 2),
      ]),
    );
    this.patch(
      {
        stops: this.spec.stops.map((stop) => ({
          ...stop,
          position: byId.get(stop.id) ?? stop.position,
        })),
      },
      'Stops distributed evenly',
    );
  };

  setKind = (kind: string) => {
    this.patch({ kind: kind as GradientKind });
  };
  setInterpolation = (space: string) => {
    this.patch({ interpolation: space as InterpolationSpace });
  };
  setHueMethod = (method: string) => {
    this.patch({ hueMethod: method as HueMethod });
  };
  setAngle = (value: number | null) => {
    if (value === null) {
      return;
    }
    // Wrap, do not clamp. figui3 declares its angle field `wrap` but never
    // implemented it, so arrowing past 360 dead-ends there.
    let wrapped = ((value % 360) + 360) % 360;
    this.patch({ angle: round(wrapped, 2) });
  };
  setCenterX = (value: number | null) => {
    if (value !== null) {
      this.patch({ centerX: round(clamp(value, 0, 100), 2) });
    }
  };
  setCenterY = (value: number | null) => {
    if (value !== null) {
      this.patch({ centerY: round(clamp(value, 0, 100), 2) });
    }
  };
  setStopPosition = (id: string, value: number | null) => {
    if (value !== null) {
      this.moveStop(id, value);
    }
  };

  /**
   * The built-in bar's pointer behaviour: press on a stop drags it, press on
   * empty track inserts one on release.
   *
   * This is a FALLBACK bar. Stop geometry belongs to the design-tools port's
   * `GradientInput`; when that lands it goes in the `<:bar>` block and this
   * never renders. Until then the component has to be usable on its own,
   * and `dragsSurface`'s `origin` (the element the press started on, held
   * stable for the whole gesture) is exactly what tells the two cases apart.
   */
  handleBarDrag = (frame: SurfaceFrame) => {
    if (this.args.disabled) {
      return;
    }
    let grabbed = (frame.origin as Element | null)?.closest?.(
      '[data-stop-id]',
    ) as HTMLElement | null;
    if (grabbed) {
      let id = grabbed.dataset['stopId'];
      if (id) {
        this.moveStop(id, frame.nx * 100);
        if (frame.phase === 'start') {
          this.select(id);
        }
      }
      return;
    }
    if (frame.phase === 'end') {
      this.addStopAt(frame.nx * 100);
    }
  };

  stopStyle = (stop: GradientStop) => {
    return cssStyleFrom([
      '--pretui-stop-x: ' + round(clamp(stop.position, 0, 100), 2) + '%',
      // `stop.color` is caller text; `cssFor` is the strong guard, the
      // allowlist the second.
      cssDeclaration('--pretui-stop-color', cssFor(stop.color)),
    ]);
  };
  isSelected = (stop: GradientStop) => stop.id === this.selectedStop?.id;
  stopLabel = (stop: GradientStop) => {
    let parsed = parseColor(stop.color);
    let described = parsed ? describeColor(parsed) : 'no colour';
    return `Stop at ${round(stop.position, 0)} percent, ${described}`;
  };

  <template>
    <div
      class='pretui-gradient'
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-gradient-editor
      ...attributes
    >
      <div
        class='pretui-gradient-preview'
        style={{this.previewStyle}}
        role='img'
        aria-label='Gradient preview'
      ></div>

      {{#if (has-block 'bar')}}
        {{yield this.barApi to='bar'}}
      {{else}}
        <div
          class='pretui-gradient-bar'
          style={{this.previewStyle}}
          {{dragsSurface this.handleBarDrag @disabled}}
        >
          {{#each this.stops key='id' as |stop|}}
            <button
              type='button'
              class='pretui-gradient-stop'
              data-stop-id={{stop.id}}
              style={{this.stopStyle stop}}
              data-state={{if (this.isSelected stop) 'selected'}}
              aria-pressed={{if (this.isSelected stop) 'true' 'false'}}
              aria-label={{this.stopLabel stop}}
              disabled={{@disabled}}
              {{on 'click' (fn this.select stop.id)}}
            ></button>
          {{/each}}
        </div>
      {{/if}}

      <div class='pretui-gradient-stops'>
        <div class='pretui-gradient-stopshead'>
          <span class='pretui-gradient-eyebrow'>Stops</span>
          <div class='pretui-gradient-actions'>
            <Button
              @appearance='plain'
              @size='xs'
              @disabled={{@disabled}}
              {{on 'click' this.addStop}}
            >Add</Button>
            <Button
              @appearance='plain'
              @size='xs'
              @disabled={{@disabled}}
              {{on 'click' this.distribute}}
            >Distribute</Button>
            <Button
              @appearance='plain'
              @size='xs'
              @disabled={{@disabled}}
              {{on 'click' this.flip}}
            >Flip</Button>
            {{#if this.hasAngle}}
              <Button
                @appearance='plain'
                @size='xs'
                @disabled={{@disabled}}
                {{on 'click' this.rotate}}
              >Rotate</Button>
            {{/if}}
          </div>
        </div>

        <ul class='pretui-gradient-list'>
          {{#each this.stops key='id' as |stop|}}
            <li class='pretui-gradient-row'>
              <ColorStopEditor
                @stop={{stop}}
                @selected={{this.isSelected stop}}
                @disabled={{@disabled}}
                @removable={{this.canRemove}}
                @onSelect={{this.select}}
                @onColorChange={{this.setStopColor}}
                @onPositionChange={{this.setStopPosition}}
                @onRemove={{this.removeStop}}
              />
            </li>
          {{/each}}
        </ul>
      </div>

      <div class='pretui-gradient-geometry'>
        <label class='pretui-gradient-control'>
          <span class='pretui-gradient-eyebrow'>Type</span>
          <Select
            @options={{KIND_OPTIONS}}
            @value={{this.spec.kind}}
            @disabled={{@disabled}}
            @onValueChange={{this.setKind}}
          />
        </label>
        {{#if this.hasAngle}}
          <label class='pretui-gradient-control'>
            <span class='pretui-gradient-eyebrow'>Angle</span>
            <ScrubInput
              @value={{this.spec.angle}}
              @min={{-360}}
              @max={{720}}
              @step={{1}}
              @precision={{0}}
              @disabled={{@disabled}}
              @onInput={{this.setAngle}}
            />
          </label>
        {{/if}}
        {{#if this.hasCenter}}
          <label class='pretui-gradient-control'>
            <span class='pretui-gradient-eyebrow'>Centre X</span>
            <ScrubInput
              @value={{this.spec.centerX}}
              @min={{0}}
              @max={{100}}
              @step={{1}}
              @precision={{1}}
              @disabled={{@disabled}}
              @onInput={{this.setCenterX}}
            />
          </label>
          <label class='pretui-gradient-control'>
            <span class='pretui-gradient-eyebrow'>Centre Y</span>
            <ScrubInput
              @value={{this.spec.centerY}}
              @min={{0}}
              @max={{100}}
              @step={{1}}
              @precision={{1}}
              @disabled={{@disabled}}
              @onInput={{this.setCenterY}}
            />
          </label>
        {{/if}}
      </div>

      {{#unless @lockInterpolation}}
        <div class='pretui-gradient-interp'>
          <label class='pretui-gradient-control'>
            <span class='pretui-gradient-eyebrow'>Interpolate in</span>
            <Select
              @options={{this.interpolationOptions}}
              @value={{this.spec.interpolation}}
              @disabled={{@disabled}}
              @onValueChange={{this.setInterpolation}}
            />
          </label>
          {{#if this.isPolar}}
            <label class='pretui-gradient-control'>
              <span class='pretui-gradient-eyebrow'>Hue path</span>
              <Select
                @options={{this.hueMethodOptions}}
                @value={{this.spec.hueMethod}}
                @disabled={{@disabled}}
                @onValueChange={{this.setHueMethod}}
              />
            </label>
          {{/if}}
        </div>
        <p class='pretui-gradient-note'>{{this.interpolationNote}}</p>
      {{/unless}}

      <span
        class='pretui-sr'
        role='status'
        aria-live='polite'
      >{{this.announcement}}</span>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-gradient {
          display: flex;
          flex-direction: column;
          gap: var(--space-3, 8px);
          container-type: inline-size;
          font-size: var(--text-ui, 12px);
          color: var(--foreground);
        }
        .pretui-gradient[data-disabled='true'] {
          opacity: 0.6;
        }
        .pretui-gradient-preview {
          height: var(--pretui-gradient-preview-h, 72px);
          border-radius: calc(var(--radius) / 1.6);
          background:
            var(--pretui-gradient-preview, none),
            var(
              --pretui-checker,
              repeating-conic-gradient(
                color-mix(in oklch, var(--foreground) 11%, transparent) 0 25%,
                transparent 0 50%
              )
            );
          background-size: cover, 8px 8px;
          box-shadow: inset 0 0 0 1px
            color-mix(in oklch, var(--foreground) 16%, transparent);
        }
        .pretui-gradient-bar {
          position: relative;
          height: 18px;
          border-radius: 999px;
          background:
            var(--pretui-gradient-preview, none),
            var(
              --pretui-checker,
              repeating-conic-gradient(
                color-mix(in oklch, var(--foreground) 11%, transparent) 0 25%,
                transparent 0 50%
              )
            );
          background-size: cover, 8px 8px;
          box-shadow: inset 0 0 0 1px
            color-mix(in oklch, var(--foreground) 16%, transparent);
          touch-action: none;
          cursor: copy;
        }
        .pretui-gradient-stop {
          position: absolute;
          top: 50%;
          left: var(--pretui-stop-x, 0%);
          width: 14px;
          height: 14px;
          margin: -7px 0 0 -7px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: var(--pretui-stop-color, transparent);
          box-shadow:
            0 0 0 2px #fff,
            0 0 0 3px rgb(0 0 0 / 0.35);
          cursor: pointer;
          z-index: var(--pretui-z-raised, 1);
        }
        .pretui-gradient-stop[data-state='selected'] {
          box-shadow:
            0 0 0 2px #fff,
            0 0 0 4px var(--primary);
        }
        .pretui-gradient-stop:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 3px;
        }
        .pretui-gradient-stops {
          display: flex;
          flex-direction: column;
          gap: var(--space-2, 5px);
        }
        .pretui-gradient-stopshead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2, 5px);
          flex-wrap: wrap;
        }
        .pretui-gradient-actions {
          display: flex;
          gap: 2px;
        }
        .pretui-gradient-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: var(--space-2, 5px);
        }
        .pretui-gradient-geometry,
        .pretui-gradient-interp {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
          gap: var(--space-2, 5px);
        }
        .pretui-gradient-control {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .pretui-gradient-eyebrow {
          font-family: var(--font-mono);
          font-size: var(--text-ui-sm, 11px);
          letter-spacing: var(--track-eyebrow, 0.06em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-gradient-note {
          margin: 0;
          font-size: var(--text-ui-sm, 11px);
          color: var(--muted-foreground);
          line-height: 1.4;
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }
        @container (max-width: 260px) {
          .pretui-gradient-geometry,
          .pretui-gradient-interp {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      }
    </style>
  </template>
}
