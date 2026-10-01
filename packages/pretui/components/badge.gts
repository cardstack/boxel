// Pretui — Badge: a count or status mark overlaid on the corner of another control.
import Component from '@glimmer/component';
import { VisuallyHidden } from './visually-hidden';
import { guidFor } from '@ember/object/internals';
import { cornerHueStyle, describesFocusable, resolveCorner, resolveCornerTone } from '../internal/corner-mark';
import type { CornerPlacement } from '../internal/corner-mark';
import type { PretuiTone, PretuiToneArg } from '../pretui-primitives';

export interface BadgeSignature {
  Args: {
    /** The number to show. Omit it, or pass `@dot`, for a mark without a number. */
    count?: number;
    /** Above this the badge reads `max+` (default 99). */
    max?: number;
    /** A small dot instead of the count. */
    dot?: boolean;
    /** Show the badge at a count of 0 (hidden by default). */
    showZero?: boolean;
    /** Hide the badge without unmounting the child. */
    invisible?: boolean;
    /** Default 'danger'. Accepts the kit's tone spellings. */
    tone?: PretuiToneArg;
    /** Which corner (default 'top-end'). The physical spellings map. */
    placement?: CornerPlacement | string;
    /** Pull the mark in for a round child such as an Avatar. */
    circular?: boolean;
    /**
     * What the count means, read after it: `@label='unread'` announces
     * "3 unread". Without it the count is announced alone.
     */
    label?: string;
  };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

/**
 * The overlay badge MUI, Ant and Mantine ship — the unread 3 on an inbox
 * icon, 99+ on an avatar. shadcn's inline Badge is Chip in Pretui; a dot
 * with no number is Indicator.
 *
 * The visible mark is `aria-hidden`: a bare "3" read in the middle of a
 * button name means nothing. The meaning is a visually hidden run after the
 * child — "3 unread" — and the child's first focusable element points at it
 * with `aria-describedby`, so focusing the control reads its own name and
 * then the count.
 */
export class Badge extends Component<BadgeSignature> {
  private spokenId = guidFor(this) + '-spoken';
  get describedBy(): string | undefined {
    return this.spoken ? this.spokenId : undefined;
  }
  get tone(): PretuiTone {
    return resolveCornerTone(this.args.tone, 'danger');
  }
  get max(): number {
    return this.args.max ?? 99;
  }
  get hasCount(): boolean {
    return typeof this.args.count === 'number' && Number.isFinite(this.args.count);
  }
  get visible(): boolean {
    if (this.args.invisible) {
      return false;
    }
    if (this.args.dot) {
      return true;
    }
    if (!this.hasCount) {
      return true;
    }
    return (this.args.count as number) > 0 || (this.args.showZero ?? false);
  }
  get isDot(): boolean {
    return (this.args.dot ?? false) || !this.hasCount;
  }
  get display(): string {
    let count = this.args.count as number;
    return count > this.max ? `${this.max}+` : String(count);
  }
  get spoken(): string | undefined {
    if (!this.visible) {
      return undefined;
    }
    let words = this.hasCount ? [String(this.args.count)] : [];
    if (this.args.label) {
      words.push(this.args.label);
    }
    return words.length ? words.join(' ') : undefined;
  }
  get style() {
    return cornerHueStyle(this.tone);
  }

  <template>
    <span
      class='pretui-badge'
      data-placement={{resolveCorner @placement}}
      data-circular={{if @circular 'true' 'false'}}
      style={{this.style}}
      data-test-pretui-badge
      ...attributes
      {{describesFocusable this.describedBy}}
    >
      {{yield}}
      {{#if this.visible}}
        <span
          class='pretui-badge-mark'
          data-dot={{if this.isDot 'true' 'false'}}
          data-tone={{this.tone}}
          aria-hidden='true'
          data-test-pretui-badge-mark
        >{{#unless this.isDot}}{{this.display}}{{/unless}}</span>
      {{/if}}
      {{#if this.spoken}}
        <VisuallyHidden id={{this.spokenId}} data-test-pretui-badge-spoken>{{this.spoken}}</VisuallyHidden>
      {{/if}}
    </span>
    <style scoped>
      .pretui-badge {
        position: relative;
        display: inline-flex;
        vertical-align: middle;
        --pretui-mark-inset: 0%;
        --pretui-mark-x: 50%;
      }
      .pretui-badge:dir(rtl) {
        --pretui-mark-x: -50%;
      }
      .pretui-badge[data-circular='true'] {
        --pretui-mark-inset: 14%;
      }
      .pretui-badge-mark {
        position: absolute;
        z-index: 1;
        display: inline-grid;
        place-items: center;
        box-sizing: border-box;
        min-inline-size: 1.125rem;
        block-size: 1.125rem;
        padding-inline: 0.3rem;
        border-radius: 999px;
        background: var(--pretui-mark-hue);
        color: var(--pretui-badge-ink, var(--card));
        box-shadow: 0 0 0 2px var(--pretui-badge-ring, var(--card));
        font-family: var(--font-sans);
        font-size: var(--text-ui-xs, 0.66rem);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        line-height: 1;
        white-space: nowrap;
        pointer-events: none;
      }
      .pretui-badge-mark[data-dot='true'] {
        min-inline-size: 0.5rem;
        inline-size: 0.5rem;
        block-size: 0.5rem;
        padding: 0;
      }
      .pretui-badge-mark[data-tone='warning'],
      .pretui-badge-mark[data-tone='attention'] {
        color: var(--foreground);
      }
      .pretui-badge[data-placement='top-end'] .pretui-badge-mark {
        inset-block-start: var(--pretui-mark-inset);
        inset-inline-end: var(--pretui-mark-inset);
        translate: var(--pretui-mark-x) -50%;
      }
      .pretui-badge[data-placement='top-start'] .pretui-badge-mark {
        inset-block-start: var(--pretui-mark-inset);
        inset-inline-start: var(--pretui-mark-inset);
        translate: calc(-1 * var(--pretui-mark-x)) -50%;
      }
      .pretui-badge[data-placement='bottom-end'] .pretui-badge-mark {
        inset-block-end: var(--pretui-mark-inset);
        inset-inline-end: var(--pretui-mark-inset);
        translate: var(--pretui-mark-x) 50%;
      }
      .pretui-badge[data-placement='bottom-start'] .pretui-badge-mark {
        inset-block-end: var(--pretui-mark-inset);
        inset-inline-start: var(--pretui-mark-inset);
        translate: calc(-1 * var(--pretui-mark-x)) 50%;
      }
    </style>
  </template>
}
