// IconButton: a square Button whose face is an icon; the accessible name rides aria-label / title.
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import { firstDefined, resolveSize } from '../pretui-primitives';
import type {
  PretuiAppearance,
  PretuiSize,
  PretuiSizeArg,
  PretuiToneArg,
} from '../pretui-primitives';
import { Button } from './button';
import type { ButtonShape, ButtonVariant } from './button';

export type IconButtonIcon = ComponentLike<{ Element: SVGSVGElement }>;

// Glyph size per @size, set as width/height attributes rather than CSS so the
// icon has an intrinsic size before any stylesheet applies.
const ICON_PX: Record<PretuiSize, number> = {
  xs: 10,
  s: 12,
  m: 14,
  l: 16,
  xl: 18,
};
export function iconSizeFor(size: PretuiSizeArg | undefined): number {
  return ICON_PX[resolveSize(size)];
}

export interface IconButtonSignature {
  Args: {
    label: string;
    /** icon component, rendered before any block content */
    icon?: IconButtonIcon;
    /** the @icon's dimensions, which otherwise follow @size */
    width?: string | number;
    height?: string | number;
    variant?: ButtonVariant;
    tone?: PretuiToneArg;
    appearance?: PretuiAppearance;
    size?: PretuiSizeArg;
    disabled?: boolean;
    /** 'pill' makes a circle, since the button is square */
    shape?: ButtonShape;
    /** renders an <a> that looks like this button; @busy and @pressed do not apply */
    href?: string;
    /** toggle state, as aria-pressed; leave undefined for a plain action */
    pressed?: boolean;
    busy?: boolean;
    /** added after @label in the accessible name while busy */
    busyLabel?: string;
    /** alias of @disabled */
    isDisabled?: boolean;
    /** alias of @busy */
    loading?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

export class IconButton extends Component<IconButtonSignature> {
  get variant() {
    return this.args.variant ?? 'secondary';
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get busy() {
    return firstDefined(this.args.busy, this.args.loading) ?? false;
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
    return this.args.width ?? iconSizeFor(this.args.size);
  }
  get iconHeight() {
    return this.args.height ?? iconSizeFor(this.args.size);
  }
  <template>
    <Button
      @variant={{this.variant}}
      @tone={{@tone}}
      @appearance={{@appearance}}
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
      <span class='pretui-iconbtn-glyph' aria-hidden='true'>
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
        .pretui-iconbtn-glyph {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        /* pressed is a tint one step stronger than the filled appearance's,
           so it reads on outlined, plain and filled alike; an accent fill has
           no stronger step, so toggles use another appearance */
        .pretui-iconbtn[aria-pressed='true']:not([data-appearance='accent']) {
          --pretui-btn-surface: color-mix(
            in oklch,
            var(--pretui-tone) 28%,
            var(--background)
          );
          --pretui-btn-surface-hover: color-mix(
            in oklch,
            var(--pretui-btn-tint) 34%,
            var(--background)
          );
        }
        @media (forced-colors: active) {
          .pretui-iconbtn[aria-pressed='true'] {
            border-color: Highlight;
          }
        }
      }
    </style>
  </template>
}
