import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ControlMeta } from 'dialkit/store';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';
import type { AnyDial } from 'test-app/lib/dial';
import { preventSelect } from 'test-app/lib/pointer';

/**
 * The spike's panel: sliders, and nothing else.
 *
 * dialkit's React port is 4,506 lines across twenty controls, and 1,654 of
 * those are the timeline this repo should not take — Choreo seeks real
 * animations, dialkit's timeline re-derives spring maths to approximate one.
 * So this draws the smallest thing that can answer the question: can you tune
 * a live Choreo score from a dialkit store.
 *
 * ## The stylesheet claim, tested
 *
 * All four of dialkit's ports render the same `dialkit-*` class names against
 * one shared 2,221-line `theme.css`. If that is true, an Ember port that emits
 * the same markup inherits the entire visual design for free — which is the
 * single biggest reason a fifth port is an afternoon rather than a fortnight.
 * These class names are dialkit's, verbatim, and `dialkit/styles.css` is
 * imported by the stage. Whether it actually looks right is the test.
 *
 * ## Where this is cheaper than React
 *
 * `Slider.tsx` is 432 lines, the largest control in the port, and most of it is
 * hand-rolled pointer maths: pointer capture, a drag origin, a delta, a
 * rubber-band at the ends. We own a drag library. `{{motion drag="x"}}` gives
 * us the gesture, so the slider below is the same control in a fraction of the
 * code — and it is the one place a Choreo port has a real advantage over the
 * ports that came before it.
 */

/**
 * Zero-width constraints: the gesture without the movement.
 *
 * A slider track must not travel — the fill and handle move, the groove stays
 * put — but we still want Motion's pan session, its pointer capture and its
 * `info.offset`. Pinning the element with `left: 0, right: 0` and no elastic
 * gives exactly that: the element cannot go anywhere, while `offset` keeps
 * reporting the raw pointer delta, because PanInfo is measured from the
 * POINTER and not from where the element ended up.
 *
 * This is the bit React's Slider has to work around rather than use: it drives
 * a MotionValue into the track's own `x` and rubber-bands it back at the ends.
 */
const PINNED = { left: 0, right: 0 } as const;

interface Signature {
  Args: {
    dial: AnyDial;
  };
}

/** the drag gain: a full track's width of travel spans the full range */
export class DialPanel extends Component<Signature> {
  @tracked private copied = false;

  /** the slider being dragged, so only that one wears the active class */
  @tracked private active: string | null = null;

  private origin = 0;
  private trackW = 1;

  /**
   * The track elements, by control path.
   *
   * The obvious version of this reads `event.target.closest('.dialkit-slider')`
   * in the drag-start handler, and it is wrong in a way worth recording: the
   * event a pan session hands its callbacks is the last POINTERMOVE, whose
   * target is whatever the move was dispatched on — the window, once the
   * gesture leaves the element. `.closest` is not a function on window, so the
   * handler throws.
   *
   * And it throws INSIDE a frame callback, taking the rest of that frame's
   * queue with it — including the `onDrag` that Motion had already scheduled
   * behind it. So the visible symptom is not an error near the mistake; it is
   * `onDragStart` firing, `onDrag` never firing, and a slider that will not
   * move. Holding the element instead of re-deriving it removes the question.
   */
  private tracks = new Map<string, HTMLElement>();

  bindTrack = modifier((el: HTMLElement, [path]: [string]) => {
    this.tracks.set(path, el);
    return () => {
      this.tracks.delete(path);
    };
  });

  get sliders() {
    return this.args.dial.controls.filter(
      (c: ControlMeta) => c.type === 'slider'
    );
  }

  valueOf = (path: string) => {
    const v = this.args.dial.raw[path];
    return typeof v === 'number' ? v : 0;
  };

  /** 0..1 across the control's own range — what the fill and handle read */
  fractionOf = (control: ControlMeta) => {
    const min = control.min ?? 0;
    const max = control.max ?? 1;
    const span = max - min || 1;
    return Math.min(1, Math.max(0, (this.valueOf(control.path) - min) / span));
  };

  fillStyle = (control: ControlMeta) =>
    `width:${this.fractionOf(control) * 100}%`;

  handleStyle = (control: ControlMeta) =>
    `left:${this.fractionOf(control) * 100}%`;

  isActive = (control: ControlMeta) => this.active === control.path;

  /**
   * The track's classes as one string, rather than a multi-line `class="..."`
   * with an `{{if}}` inside it.
   *
   * Both forms are legal Glimmer. The one-string form is here because the
   * template parser is fragile about what sits inside a `<template>` at depth,
   * and it fails in a way that names neither the line nor the cause: the whole
   * file is rejected with `Parsing error: Invalid count value: -1`, which is a
   * negative `String.repeat` deep in its indentation maths. A `>` inside an
   * `{{! }}` comment does the same thing — writing a CSS child selector in
   * prose is enough to take the file out. Both were found by bisection, and
   * neither is worth re-discovering.
   */
  classFor = (control: ControlMeta) =>
    this.isActive(control)
      ? 'dialkit-slider dialkit-slider-active'
      : 'dialkit-slider';

  /**
   * Motion hands us the offset from where the finger went down, so the value
   * is the value AT GRAB plus that offset scaled to the range. Reading the
   * live value instead would compound rounding on every frame and drift away
   * from the pointer over a long drag.
   */
  grab = (control: ControlMeta) => {
    this.active = control.path;
    this.origin = this.valueOf(control.path);
    this.trackW =
      this.tracks.get(control.path)?.getBoundingClientRect().width || 1;
  };

  drag = (
    control: ControlMeta,
    _event: PointerEvent,
    info: { offset: { x: number; y: number } }
  ) => {
    const min = control.min ?? 0;
    const max = control.max ?? 1;
    const step = control.step ?? 1;
    const next = this.origin + (info.offset.x / this.trackW) * (max - min);
    const snapped = Math.round(next / step) * step;
    const clamped = Math.min(max, Math.max(min, snapped));
    if (clamped !== this.valueOf(control.path)) {
      this.args.dial.set(control.path, clamped);
    }
  };

  drop = () => {
    this.active = null;
  };

  copy = async () => {
    await navigator.clipboard?.writeText(this.args.dial.instruction);
    this.copied = true;
    setTimeout(() => (this.copied = false), 1400);
  };

  <template>
    {{! `data-mode="inline"` is dialkit's own embedded mode: its theme sets
        `.dialkit-panel` to `position: fixed; z-index: 9999` because the panel
        normally floats over the app, and the inline attribute puts it back in
        flow. `.dialkit-panel-inner` is the element that carries the surface —
        the glass background, the border, the blur — so leaving it out gets a
        panel with no panel in it. }}
    <div
      class="dialkit-root dial-spike"
      data-mode="inline"
      {{on "selectstart" preventSelect}}
    >
      <div class="dialkit-panel" data-mode="inline">
        <div class="dialkit-panel-inner">
          {{! dialkit's own header and title classes, so the type and the rule
              under it come from the package rather than approximate it }}
          <header class="dialkit-panel-header dial-spike-head">
            <span
              class="dialkit-folder-title dial-spike-name"
            >{{@dial.name}}</span>
            <button
              type="button"
              class="dial-spike-btn"
              {{on "click" @dial.reset}}
            >reset</button>
            <button
              type="button"
              class="dial-spike-btn"
              {{on "click" this.copy}}
            >
              {{if this.copied "copied" "copy"}}
            </button>
          </header>

          {{! `.dialkit-folder-inner` is dialkit's own control-row container: a
              flex column with a 6px gap. Using it rather than spacing the rows
              by hand is the same trade as the rest of this panel — the package
              decides what it looks like. dialkit nests it inside two more
              wrappers that carry the collapse behaviour and a divider, which
              this panel has no use for, so it stands alone here. }}
          <div class="dialkit-folder-inner">
            {{#each this.sliders key="path" as |control|}}
              <div class="dialkit-slider-wrapper">
                <div
                  class={{this.classFor control}}
                  {{this.bindTrack control.path}}
                  {{motion
                    drag="x"
                    dragConstraints=PINNED
                    dragMomentum=false
                    dragElastic=0
                    onDragStart=(fn this.grab control)
                    onDrag=(fn this.drag control)
                    onDragEnd=this.drop
                  }}
                >
                  <div
                    class="dialkit-slider-fill"
                    style={{this.fillStyle control}}
                  >
                  </div>
                  <div
                    class="dialkit-slider-handle"
                    style={{this.handleStyle control}}
                  ></div>
                  <span class="dialkit-slider-label">{{control.label}}</span>
                  <span class="dialkit-slider-value">
                    {{this.valueOf control.path}}
                  </span>
                </div>
              </div>
            {{/each}}
          </div>
        </div>
      </div>
    </div>
  </template>
}

export default DialPanel;
