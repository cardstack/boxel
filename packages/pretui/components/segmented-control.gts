// Pretui — SegmentedControl: compact view switcher. The active card is
// motion-core's SlidingHighlight, not the segment's own background.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { slidingHighlight, SlidingHighlight } from '../motion-core';
import { emit, firstDefined } from '../pretui-primitives';

export interface SegmentOption {
  value: string;
  label: string;
}

export interface SegmentedControlSignature {
  Args: {
    options?: SegmentOption[];
    /** alias — the canonical flat-collection noun */
    items?: SegmentOption[];
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    /** alias — the HTML/Mantine/Ant notify name */
    onChange?: (value: string) => void;
    /** Accessible name for the group. A radiogroup with no name announces
     * as an unnamed group; supply this whenever no visible heading precedes
     * the control. */
    label?: string;
  };
  Element: HTMLDivElement;
}

// The active segment's card face is not painted by the segment: it is ONE
// <SlidingHighlight @variant='pill' /> that travels between segments, driven
// by motion-core's slidingHighlight modifier on the rail. Adopting the shared
// primitive rather than keeping a local copy means the measuring code, the
// first-paint suppression and the reduced-motion fallback live in exactly one
// place for Segmented, Tabs and anything that adopts it next. The modifier
// reads the same data-state='active' the styling already used, so nothing
// here had to hand over its DOM or thread an active index through.
//
// **Semantics rebuilt 2026-08-13.** This used to be `role='tablist'` over
// plain `<button>`s — invalid ARIA (a tablist's children must be tabs) and
// the wrong pattern anyway, because a segmented control swaps a *value*, not
// a panel. Tabs, three components down this file, is the one that swaps a
// panel. It is now what it always was: a single-choice value picker, built on
// the same native `<input type='radio'>` foundation `RadioGroup` uses, which
// hands over the entire APG radio contract — one tab stop for the group,
// arrows to move and select, checked state exposed, form participation — with
// no roving-tabindex code and no keyboard handler of our own. Nothing about
// how it LOOKS changed: the radio is visually hidden, the `<label>` wears the
// old `.pretui-seg-item` dress and keeps `data-state='active'` so
// SlidingHighlight measures exactly what it measured before.
export class SegmentedControl extends Component<SegmentedControlSignature> {
  @tracked internal =
    this.args.defaultValue ??
    (this.args.options ?? this.args.items ?? [])[0]?.value;
  name = `${guidFor(this)}-seg`;
  get options(): SegmentOption[] {
    return firstDefined(this.args.options, this.args.items) ?? [];
  }
  get value() {
    return this.args.value ?? this.internal;
  }
  pick = (option: SegmentOption) => {
    if (this.args.value === undefined) {
      this.internal = option.value;
    }
    emit([this.args.onValueChange, this.args.onChange], option.value);
  };
  isActive = (option: SegmentOption) => this.value === option.value;
  <template>
    <div
      class='pretui-seg'
      role='radiogroup'
      aria-label={{@label}}
      data-test-pretui-segmented
      ...attributes
      {{slidingHighlight}}
    >
      <SlidingHighlight @variant='pill' />
      {{#each this.options as |option|}}
        <label
          class='pretui-seg-item'
          data-state={{if (this.isActive option) 'active'}}
        >
          <input
            type='radio'
            class='pretui-seg-input'
            name={{this.name}}
            value={{option.value}}
            checked={{this.isActive option}}
            {{on 'change' (fn this.pick option)}}
          />
          {{option.label}}
        </label>
      {{/each}}
    </div>
    <style scoped>
      .pretui-seg {
        position: relative;
        display: inline-flex;
        gap: 2px;
        padding: 2px;
        background: var(--inset, var(--boxel-100));
        border-radius: calc(var(--radius) + 2px);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }
      .pretui-seg-item {
        /* positioned + z-index so the label paints above the travelling
           highlight, which is a sibling rather than this button's own
           background. `raised` is the kit scale's in-component tier
           (pretui-css.gts) — it never competes outside this box. */
        position: relative;
        z-index: var(--pretui-z-raised, 1);
        display: inline-flex;
        align-items: center;
        height: 24px;
        padding: 0 11px;
        border: 0;
        background: none;
        border-radius: var(--radius);
        font-family: inherit;
        font-size: var(--text-ui, 12px);
        font-weight: 500;
        letter-spacing: inherit;
        color: var(--muted-foreground);
        cursor: pointer;
        white-space: nowrap;
        /* the label crosses to ink over the same beat the pill travels, so
           the two halves of the state change read as one move */
        transition: color 150ms var(--pretui-ease-snap, ease);
      }
      /* the radio carries the semantics and the keyboard; the label carries
         the look. Kept 1px and in flow rather than display:none so it stays
         focusable and so the focus ring below has something to sit on. */
      .pretui-seg-input {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: 0;
        opacity: 0;
        pointer-events: none;
      }
      .pretui-seg-item:has(.pretui-seg-input:focus-visible) {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }
      .pretui-seg-item[data-state='active'] {
        /* the card face and control shadow now belong to the shared
           SlidingHighlight in its pill cut — identical treatment, one
           element, and it travels */
        color: var(--foreground);
      }
      /* coarse pointers get a real hit target without moving the fine one */
      @media (any-pointer: coarse) {
        .pretui-seg-item {
          min-height: 34px;
          padding: 0 14px;
        }
      }
    </style>
  </template>
}

