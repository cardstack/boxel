// IconButton: a square Button whose face is an icon; the accessible name rides aria-label / title.
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import { Button, resolveBusy, resolveDisabled } from './button';
import type { ButtonSignature } from './button';

export type IconButtonIcon = ComponentLike<{ Element: SVGSVGElement }>;

// Glyph size, in em of the button's font size so it follows @size and the
// theme's text scale. Set as width/height attributes rather than CSS so the
// icon has an intrinsic size before any stylesheet applies.
export const ICON_SIZE = '1.25em';

// Every Button argument, plus what an icon-only button needs.
export interface IconButtonSignature {
  Args: ButtonSignature['Args'] & {
    label: string;
    /** icon component, rendered before any block content */
    icon?: IconButtonIcon;
    /** the @icon's dimensions, which otherwise follow @size */
    iconWidth?: string | number;
    iconHeight?: string | number;
    /** toggle state, as aria-pressed; leave undefined for a plain action.
     *  Does not apply with @href */
    pressed?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

export class IconButton extends Component<IconButtonSignature> {
  // Secondary chrome by default: neutral and outlined, unless the caller picks
  // a tone or appearance, or the deprecated @variant names both.
  get tone() {
    return this.args.tone ?? (this.args.variant ? undefined : 'neutral');
  }
  get appearance() {
    return this.args.appearance ?? (this.args.variant ? undefined : 'outlined');
  }
  get disabled() {
    return resolveDisabled(this.args);
  }
  get busy() {
    return resolveBusy(this.args);
  }
  // aria-label replaces the content as the name, so Button's busy text never
  // reaches it; the busy label joins the name here instead.
  get accessibleName() {
    let { label, busyLabel, href } = this.args;
    return this.busy && busyLabel && !href ? `${label} ${busyLabel}` : label;
  }
  get ariaPressed() {
    let { pressed, href } = this.args;
    return pressed === undefined || href ? undefined : String(pressed);
  }
  get iconWidth() {
    return this.args.iconWidth ?? ICON_SIZE;
  }
  get iconHeight() {
    return this.args.iconHeight ?? ICON_SIZE;
  }
  <template>
    <Button
      @variant={{@variant}}
      @tone={{this.tone}}
      @appearance={{this.appearance}}
      @size={{@size}}
      @disabled={{this.disabled}}
      @shape={{@shape}}
      @href={{@href}}
      @busy={{this.busy}}
      class='pretui-iconbtn'
      aria-label={{this.accessibleName}}
      aria-pressed={{this.ariaPressed}}
      title={{@label}}
      data-test-pretui-icon-button
      ...attributes
    >
      {{! hidden because aria-label names the button; an icon with its own
          <title>, or a text glyph, would otherwise be read a second time }}
      <span
        class='pretui-iconbtn-glyph'
        aria-hidden='true'
        data-test-pretui-icon-button-glyph
      >
        {{#if @icon}}
          <@icon width={{this.iconWidth}} height={{this.iconHeight}} />
        {{/if}}
        {{yield}}
      </span>
    </Button>
    <style scoped>
      /* above Button's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-iconbtn {
          padding: 0;
          width: var(--pretui-button-h, 2.24em);
        }
        /* square against Button's 24px minimum height at xs */
        .pretui-iconbtn[data-size='xs'] {
          width: max(var(--pretui-button-h, 2.24em), 1.5rem);
        }
        /* block-level, so the glyph is not set on Button's label line and
           its baseline */
        .pretui-iconbtn-glyph {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        /* pressed is a tint one step stronger than the filled appearance's,
           so it reads on outlined, plain and filled alike; an accent fill has
           no stronger step and a link has no fill, so toggles use another
           appearance */
        .pretui-iconbtn[aria-pressed='true']:not(
            [data-appearance='accent'],
            [data-appearance='link']
          ) {
          --_iconbtn-pressed-base: var(--background);
          --pretui-btn-surface: color-mix(
            in oklch,
            var(--pretui-tone) 28%,
            var(--_iconbtn-pressed-base)
          );
          --pretui-btn-surface-hover: color-mix(
            in oklch,
            var(--pretui-btn-tint) 34%,
            var(--_iconbtn-pressed-base)
          );
        }
        /* over the outlined appearance's own base surface, when a theme sets
           one, so pressing changes the tint and not the base */
        .pretui-iconbtn[aria-pressed='true'][data-appearance='outlined'] {
          --_iconbtn-pressed-base: var(
            --pretui-button-secondary-bg,
            var(--background)
          );
        }
        /* not when disabled, whose GrayText edge from Button is its only cue */
        @media (forced-colors: active) {
          .pretui-iconbtn[aria-pressed='true']:not(
              :disabled,
              [aria-disabled='true']
            ) {
            border-color: Highlight;
          }
        }
      }
    </style>
  </template>
}
