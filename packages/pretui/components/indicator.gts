// Pretui — Indicator: a named status dot on the corner of another element — online, live, unread.
import Component from '@glimmer/component';
import { VisuallyHidden } from './visually-hidden';
import { guidFor } from '@ember/object/internals';
import { cornerHueStyle, describesFocusable, resolveCorner, resolveCornerTone } from '../internal/corner-mark';
import type { CornerPlacement } from '../internal/corner-mark';
import type { PretuiTone, PretuiToneArg } from '../pretui-primitives';

export interface IndicatorSignature {
  Args: {
    /** Required: what the dot means ('Online', 'Unread'). It is announced after the child. */
    label: string;
    /** Default 'success'. Accepts the kit's tone spellings. */
    tone?: PretuiToneArg;
    /** A pulsing ring for something live. Reduced motion keeps the solid dot. */
    ping?: boolean;
    /** Which corner (default 'top-end'). The physical spellings map. */
    placement?: CornerPlacement | string;
    /** Pull the dot in for a round child such as an Avatar. */
    circular?: boolean;
    /** Hide the dot, and its announcement, without unmounting the child. */
    invisible?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

/**
 * A dot with no number; a count is Badge. The dot is decoration and
 * `aria-hidden`; `@label` is the meaning, as a visually hidden run after the
 * child, so "Ana Ruiz, Online" reads in order, and a focusable child points
 * at it with `aria-describedby` so focus reads it too. Colour and the ping are never
 * the only signal (Law 6): the label always travels with them.
 */
export class Indicator extends Component<IndicatorSignature> {
  private labelId = guidFor(this) + '-label';
  get describedBy(): string | undefined {
    return this.args.invisible ? undefined : this.labelId;
  }
  get tone(): PretuiTone {
    return resolveCornerTone(this.args.tone, 'success');
  }
  get style() {
    return cornerHueStyle(this.tone);
  }
  <template>
    <span
      class='pretui-indicator'
      data-placement={{resolveCorner @placement}}
      data-circular={{if @circular 'true' 'false'}}
      style={{this.style}}
      data-test-pretui-indicator
      ...attributes
      {{describesFocusable this.describedBy}}
    >
      {{yield}}
      {{#unless @invisible}}
        <span
          class='pretui-indicator-dot'
          data-ping={{if @ping 'true' 'false'}}
          data-tone={{this.tone}}
          aria-hidden='true'
          data-test-pretui-indicator-dot
        ></span>
        <VisuallyHidden id={{this.labelId}} data-test-pretui-indicator-label>{{@label}}</VisuallyHidden>
      {{/unless}}
    </span>
    <style scoped>
      .pretui-indicator {
        position: relative;
        display: inline-flex;
        vertical-align: middle;
        --pretui-mark-inset: 0%;
        --pretui-mark-x: 50%;
      }
      .pretui-indicator:dir(rtl) {
        --pretui-mark-x: -50%;
      }
      .pretui-indicator[data-circular='true'] {
        --pretui-mark-inset: 14%;
      }
      .pretui-indicator-dot {
        position: absolute;
        z-index: 1;
        inline-size: var(--pretui-indicator-size, 0.625rem);
        block-size: var(--pretui-indicator-size, 0.625rem);
        border-radius: 50%;
        background: var(--pretui-mark-hue);
        box-shadow: 0 0 0 2px var(--pretui-indicator-ring, var(--card));
        pointer-events: none;
      }
      .pretui-indicator-dot[data-ping='true']::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: var(--pretui-mark-hue);
        animation: pretui-indicator-ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite;
      }
      .pretui-indicator[data-placement='top-end'] .pretui-indicator-dot {
        inset-block-start: var(--pretui-mark-inset);
        inset-inline-end: var(--pretui-mark-inset);
        translate: var(--pretui-mark-x) -50%;
      }
      .pretui-indicator[data-placement='top-start'] .pretui-indicator-dot {
        inset-block-start: var(--pretui-mark-inset);
        inset-inline-start: var(--pretui-mark-inset);
        translate: calc(-1 * var(--pretui-mark-x)) -50%;
      }
      .pretui-indicator[data-placement='bottom-end'] .pretui-indicator-dot {
        inset-block-end: var(--pretui-mark-inset);
        inset-inline-end: var(--pretui-mark-inset);
        translate: var(--pretui-mark-x) 50%;
      }
      .pretui-indicator[data-placement='bottom-start'] .pretui-indicator-dot {
        inset-block-end: var(--pretui-mark-inset);
        inset-inline-start: var(--pretui-mark-inset);
        translate: calc(-1 * var(--pretui-mark-x)) 50%;
      }
      @keyframes pretui-indicator-ping {
        75%,
        100% {
          scale: 2.2;
          opacity: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-indicator-dot[data-ping='true']::after {
          animation: none;
          opacity: 0;
        }
      }
    </style>
  </template>
}
