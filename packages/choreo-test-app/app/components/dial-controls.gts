import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ControlMeta } from 'dialkit/store';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';
import type { AnyDial } from 'test-app/lib/dial';

/**
 * One level of a dial panel's control tree, and itself again for the next.
 *
 * The spike this grew out of drew a flat list: `controls.filter(type ===
 * 'slider')`, which was all Hang's two numbers ever needed. dialkit's store has
 * always handed out a TREE — `ControlMeta` carries `children?: ControlMeta[]`
 * and a nested object in the config becomes `type: 'folder'` (dialkit store
 * index.js:569) — and the flat filter simply threw the branches away.
 *
 * Drift is the demo that made that a gap rather than a shortcut. Its config is
 * nested by construction: a macro over three named groups, one of which you
 * want closed until the day you care about it. So this walks the tree, renders
 * a folder as a folder, and recurses.
 *
 * ## A correction to docs/drift.md
 *
 * That note says a spring pair should be one `type: 'spring'` control rather
 * than two sliders, and calls it cheap once folders exist. It is not cheap. The
 * store does not emit `'spring'` for a `SpringConfig` at all — it emits
 * `type: 'transition'` (index.js:552) whose VALUE is the whole spring object,
 * plus a companion `path.__mode` that switches between an easing curve, a
 * two-number "simple" form and a five-number "advanced" one. Drawing it means
 * drawing all three modes and the mode switch. Folders of ordinary sliders get
 * the same nesting for none of that, so that is what this does; `'spring'` is a
 * real feature and a separate afternoon.
 */
const PINNED = { left: 0, right: 0 } as const;

interface Signature {
  Args: {
    controls: ControlMeta[];
    dial: AnyDial;
  };
}

export class DialControls extends Component<Signature> {
  /** the slider being dragged, so only that one wears the active class */
  @tracked private active: string | null = null;

  /**
   * Which folders this level has been opened or closed by hand.
   *
   * A Map and not a Set because there are three states, not two: opened,
   * closed, and never touched — and the third one has to fall through to the
   * config's own `defaultOpen`, which is how `_collapsed: true` in the config
   * gets to decide what a folder looks like the first time anyone sees it.
   */
  @tracked private opened = new Map<string, boolean>();

  private origin = 0;
  private trackW = 1;

  private tracks = new Map<string, HTMLElement>();

  bindTrack = modifier((el: HTMLElement, [path]: [string]) => {
    this.tracks.set(path, el);
    return () => {
      this.tracks.delete(path);
    };
  });

  isOpen = (control: ControlMeta) =>
    this.opened.get(control.path) ?? control.defaultOpen ?? true;

  toggle = (control: ControlMeta) => {
    const next = new Map(this.opened);
    next.set(control.path, !this.isOpen(control));
    this.opened = next;
  };

  /** dialkit's chevron rotates rather than swapping glyph; so does this one */
  chevronStyle = (control: ControlMeta) =>
    this.isOpen(control) ? 'transform:rotate(90deg)' : 'transform:rotate(0deg)';

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

  /**
   * The value, at the precision its own step implies.
   *
   * A 0.01-step slider that prints `0.7300000000000001` is a panel nobody
   * trusts, and the step is the only thing that knows how many places are
   * meaningful — a range does not.
   */
  shownValue = (control: ControlMeta) => {
    const step = control.step ?? 1;
    const places = step >= 1 ? 0 : (String(step).split('.')[1]?.length ?? 2);
    return this.valueOf(control.path).toFixed(places);
  };

  /**
   * The track's classes as one string, rather than a multi-line `class="..."`
   * with an `{{if}}` inside it — see the note in dial-panel.gts. The template
   * parser rejects the whole file with `Parsing error: Invalid count value: -1`
   * for that shape, naming neither the line nor the cause.
   */
  classFor = (control: ControlMeta) =>
    this.active === control.path
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

  isSlider = (control: ControlMeta) => control.type === 'slider';

  isFolder = (control: ControlMeta) =>
    control.type === 'folder' && !!control.children;

  /** the template cannot narrow `children?`, so the narrowing happens here */
  childrenOf = (control: ControlMeta): ControlMeta[] => control.children ?? [];

  <template>
    {{#each @controls key="path" as |control|}}
      {{#if (this.isSlider control)}}
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
            <div class="dialkit-slider-fill" style={{this.fillStyle control}}>
            </div>
            <div
              class="dialkit-slider-handle"
              style={{this.handleStyle control}}
            ></div>
            <span class="dialkit-slider-label">{{control.label}}</span>
            <span class="dialkit-slider-value">{{this.shownValue
                control
              }}</span>
          </div>
        </div>
      {{else if (this.isFolder control)}}
        <div class="dialkit-folder">
          <div
            class="dialkit-folder-header"
            role="button"
            tabindex="0"
            {{on "click" (fn this.toggle control)}}
          >
            <div class="dialkit-folder-header-top">
              <div class="dialkit-folder-title-row">
                <span
                  class="dial-spike-chevron"
                  style={{this.chevronStyle control}}
                ></span>
                <span class="dialkit-folder-title">{{control.label}}</span>
              </div>
            </div>
          </div>
          {{#if (this.isOpen control)}}
            {{! Rendered away rather than collapsed to zero height. dialkit's
                own port animates this, and it could here too — but a folder
                that is merely hidden keeps every slider inside it live, and a
                live slider inside a closed folder is a drag target nobody can
                see. }}
            <div class="dialkit-folder-content">
              <div class="dialkit-folder-inner">
                <DialControls
                  @dial={{@dial}}
                  @controls={{this.childrenOf control}}
                />
              </div>
            </div>
          {{/if}}
        </div>
      {{/if}}
    {{/each}}
  </template>
}

export default DialControls;
