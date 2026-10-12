// Pretui — SegmentedControl: compact view switcher. The active card is a
// SlidingHighlight pill, not the segment's own background.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { slidingHighlight, SlidingHighlight } from './sliding-highlight';
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
    disabled?: boolean;
  };
  Element: HTMLDivElement;
}

// The active segment's card face is one <SlidingHighlight @variant='pill' />
// that slides between segments, driven by the slidingHighlight modifier on
// the rail; it reads each label's data-state='active'.
//
// A radiogroup, not a tablist: a segmented control picks a value, not a
// panel. Native radios sharing a name give the APG radio contract (one tab
// stop, arrows move and select, checked state, form participation) with no
// keyboard code here; each radio is visually hidden and its label is the face.
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
    // controlled: the browser already moved the radio; move it back unless the
    // owner took the new value
    if (this.args.value !== undefined && this.args.value !== option.value) {
      for (let radio of document.getElementsByName(
        this.name,
      ) as NodeListOf<HTMLInputElement>) {
        radio.checked = radio.value === this.args.value;
      }
    }
  };
  isActive = (option: SegmentOption) => this.value === option.value;
  <template>
    <div
      class='pretui-seg'
      role='radiogroup'
      aria-label={{@label}}
      {{slidingHighlight}}
      data-test-pretui-segmented
      ...attributes
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
            disabled={{@disabled}}
            {{on 'change' (fn this.pick option)}}
            data-test-pretui-segmented-option={{option.value}}
          />
          <span
            class='pretui-seg-text'
            data-text={{option.label}}
          >{{option.label}}</span>
        </label>
      {{/each}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-seg {
          /* the rail's gap, padding and radius offset move together, so the
             pill's corner stays concentric with the rail's */
          --pretui-seg-inset: var(--boxel-sp-6xs);
          /* the active label's weight; the hidden copy below must match it */
          --pretui-seg-active-weight: 600;
          /* Button's corner, shared by the segments and the pill; the rail
             adds the inset so the pill's corner stays concentric */
          --pretui-seg-radius: calc(var(--radius) - 2px);
          --pretui-highlight-radius: var(--pretui-seg-radius);

          position: relative;
          display: inline-flex;
          gap: var(--pretui-seg-inset);
          padding: var(--pretui-seg-inset);
          background-color: var(--inset);
          color: var(--foreground);
          border-radius: calc(var(--pretui-seg-radius) + var(--pretui-seg-inset));
          box-shadow: 0 0 0 1px var(--border);
        }
        .pretui-seg:has(.pretui-seg-input:disabled) {
          opacity: 0.5;
        }
        .pretui-seg-item {
          /* above the pill, which is a sibling, not the label's background;
             raised is the kit's in-component stacking tier */
          position: relative;
          z-index: var(--pretui-z-raised, 1);
          display: inline-flex;
          align-items: center;
          height: 1.5rem;
          padding: 0 var(--boxel-sp-sm);
          border-radius: var(--pretui-seg-radius);
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          line-height: var(--boxel-ui-label-line-height);
          letter-spacing: var(--boxel-ui-label-letter-spacing);
          color: var(--muted-foreground);
          cursor: pointer;
          white-space: nowrap;
          /* the ink shift keeps the pill's timing, so the two read as one move */
          transition: color 180ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .pretui-seg-item:has(.pretui-seg-input:disabled) {
          cursor: default;
        }
        /* the radio carries the semantics and the keyboard; the label carries
           the look. Kept 1px rather than display:none so it stays focusable
           and the focus ring below has something to follow. */
        .pretui-seg-input {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: 0;
          opacity: 0;
          pointer-events: none;
        }
        /* the radio is visually hidden, so its label shows the focus */
        .pretui-seg-item:has(.pretui-seg-input:focus-visible) {
          outline: 2px solid var(--ring);
        }
        /* the label sits on the pill's --card face */
        .pretui-seg-item[data-state='active'] {
          color: var(--card-foreground);
          font-weight: var(--pretui-seg-active-weight);
        }
        /* a hidden bold copy under the label holds every segment at its bold
           width, so selecting one never shifts its neighbors or the pill */
        .pretui-seg-text {
          display: inline-grid;
        }
        .pretui-seg-text::after {
          content: attr(data-text);
          height: 0;
          overflow: hidden;
          visibility: hidden;
          font-weight: var(--pretui-seg-active-weight);
        }
        /* coarse pointers get a real hit target without moving the fine one */
        @media (any-pointer: coarse) {
          .pretui-seg-item {
            min-height: 2.125rem;
            padding: 0 var(--boxel-sp);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-seg-item {
            transition: none;
          }
        }
      }
    </style>
  </template>
}

