import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { array, concat, hash } from '@ember/helper';
import { LinkTo } from '@ember/routing';

import cn from '../../helpers/cn.ts';
import { eq, not, or } from '../../helpers/truth-helpers.ts';
import LoadingIndicator from '../loading-indicator/index.gts';

export type BoxelButtonKind =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'destructive'
  | 'danger' // deprecated, same as 'destructive'
  | 'text-only'
  | 'primary-dark'
  | 'secondary-light'
  | 'secondary-dark';

export const buttonKindOptions: BoxelButtonKind[] = [
  'default',
  'primary',
  'secondary',
  'muted',
  'destructive',
  'text-only',
  'primary-dark',
  'secondary-light',
  'secondary-dark',
];

export type BoxelButtonSize =
  | 'auto'
  | 'extra-small'
  | 'small'
  | 'base'
  | 'tall'
  | 'touch';

export const buttonSizeOptions = [
  'base',
  'auto',
  'extra-small',
  'small',
  'tall',
  'touch',
];

interface Signature {
  Args: {
    as?: string;
    class?: string;
    disabled?: boolean;
    href?: string;
    kind?: BoxelButtonKind;
    loading?: boolean;
    models?: any;
    query?: any;
    rectangular?: boolean;
    route?: any;
    size?: BoxelButtonSize;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}
const ButtonComponent: TemplateOnlyComponent<Signature> = <template>
  {{#let
    (cn
      'boxel-button'
      @class
      (concat 'size-' (if @size @size 'base'))
      (concat 'kind-' (if @kind @kind 'default'))
      loading=@loading
      rectangular=@rectangular
    )
    as |classes|
  }}
    {{#if (or (not @as) (eq @as 'button'))}}
      <button
        class={{classes}}
        aria-label={{if @loading 'loading'}}
        aria-disabled={{@disabled}}
        disabled={{@disabled}}
        data-test-boxel-button
        ...attributes
      >
        {{#if @loading}}
          <LoadingIndicator
            class='loading-indicator'
            @color='var(--boxel-button-text-color)'
            data-test-boxel-button-loading-indicator
          />
        {{/if}}
        {{yield}}
      </button>
    {{else if (eq @as 'anchor')}}
      <a
        class={{classes}}
        href={{unless @disabled @href}}
        data-test-boxel-button
        ...attributes
      >
        {{yield}}
      </a>
    {{else if (eq @as 'link-to')}}
      <LinkTo
        class={{classes}}
        @route={{@route}}
        @models={{if @models @models (array)}}
        @query={{if @query @query (hash)}}
        @disabled={{@disabled}}
        data-test-boxel-button
        tabindex={{if @disabled -1 0}}
        ...attributes
      >
        {{yield}}
      </LinkTo>
    {{/if}}
  {{/let}}
  <style scoped>
    @layer boxelComponentL1 {
      /* Button */
      .boxel-button {
        --boxel-loading-indicator-size: var(
          --boxel-button-loading-icon-size,
          var(--boxel-icon-xs)
        );

        display: inline-flex;
        justify-content: center;
        height: min-content;
        align-items: center;
        border-radius: var(
          --boxel-button-border-radius,
          var(--radius, var(--boxel-border-radius))
        );
        transition: var(
          --boxel-button-transition,
          var(--boxel-transition-properties)
        );

        /* kind variants + disabled state */
        border: var(--boxel-button-border, none);
        color: var(--boxel-button-text-color);
        background-color: var(--boxel-button-color);

        /* size variants */
        font: var(--boxel-button-font, 700 var(--boxel-font-sm));
        font-family: inherit;
        min-height: var(--boxel-button-min-height);
        min-width: var(--boxel-button-min-width);
        padding: var(--boxel-button-padding);
        letter-spacing: var(--boxel-button-letter-spacing, var(--boxel-lsp));
        box-shadow: var(--boxel-button-box-shadow);
      }
      .boxel-button:not(.rectangular) {
        border-radius: var(--boxel-button-border-radius, var(--radius, 100px));
      }
      .boxel-button:not(:disabled):hover {
        background-color: color-mix(
          in oklab,
          var(--boxel-button-color) 90%,
          transparent
        );
      }
      .boxel-button:focus-visible {
        outline-color: var(--ring, var(--boxel-highlight));
        outline-offset: 2px;
      }

      .loading-indicator {
        margin-right: var(
          --boxel-button-loading-indicator-gap,
          var(--boxel-sp-xxs)
        );
      }

      /* select disabled buttons and links that don't have href */

      /*
        a.disabled-link is a special case for an automatically appended class by the LinkTo component
        the LinkTo component appends the href regardless, so we have to select it in other ways.
        Removing the chained classes will make kind-variants overwrite the disabled style on the LinkTo (specificity issues)
      */
      .boxel-button:disabled,
      a.boxel-button:not([href]),
      a.boxel-button[href=''],
      a.boxel-button.disabled-link {
        --boxel-button-color: var(--boxel-border-color);
        --boxel-button-border: 1px solid var(--boxel-button-color);
        --boxel-button-text-color: var(--boxel-450);
        --boxel-button-box-shadow: none;

        cursor: default;
      }

      /* the a element does not have a disabled attribute. Clicking will still trigger event listeners */
      a.boxel-button:not([href]),
      a.boxel-button[href=''],
      a.boxel-button.disabled-link {
        pointer-events: none;
      }

      /*
        loading state.
        this should only be relevant for buttons - links shouldn't need it.
        We want to preserve the "normal" styling of the button but not allow interaction
      */
      .loading {
        pointer-events: none;
      }

      /* overwrite the global style for links in global.css */
      a.boxel-button:hover {
        color: var(--boxel-button-text-color);
      }

      /**
      * Kind variants - variants that control the colors on a button
      *
      * The @kind argument on the button component should create a corresponding class with format
      * kind-@kind
      *
      * Classes for the @kind argument can control the following properties:
      *
      * --boxel-button-color (css "background-color" property)
      * --boxel-button-border (css shorthand "border" property)
      * --boxel-button-text-color (css "color" property)
      *
      */
      .kind-default {
        --boxel-button-color: var(--background, var(--boxel-light));
        --boxel-button-text-color: var(--foreground, var(--boxel-dark));
        --boxel-button-border: 1px solid var(--border, var(--boxel-400));
      }
      .kind-default:not(:disabled):hover,
      .kind-default:not(:disabled):active {
        --boxel-button-color: var(--accent, var(--boxel-light));
        --boxel-button-text-color: var(--accent-foreground, var(--boxel-dark));
        --boxel-button-border: 1px solid var(--border, var(--boxel-dark));
      }

      .kind-primary {
        --boxel-button-color: var(--primary, var(--boxel-highlight));
        --boxel-button-text-color: var(--primary-foreground, var(--boxel-dark));
      }
      .kind-primary:not(:disabled):hover,
      .kind-primary:not(:disabled):active {
        --boxel-button-color: var(--primary, var(--boxel-highlight-hover));
      }

      .kind-secondary {
        --boxel-button-color: var(--secondary, var(--boxel-light));
        --boxel-button-text-color: var(
          --secondary-foreground,
          var(--boxel-dark)
        );
        --boxel-button-border: 1px solid
          var(--secondary, var(--boxel-button-border-color));
      }
      .kind-secondary:not(:disabled):hover,
      .kind-secondary:not(:disabled):active {
        --boxel-button-border: 1px solid var(--secondary, var(--boxel-dark));
      }

      .kind-muted {
        --boxel-button-color: var(--muted, var(--boxel-100));
        --boxel-button-text-color: var(--muted-foreground, var(--boxel-dark));
      }
      .kind-muted:not(:disabled):hover {
        background-color: color-mix(
          in oklab,
          var(--muted, var(--boxel-100)) 96%,
          var(--muted-foreground, var(--boxel-dark))
        );
      }

      .kind-destructive,
      .kind-danger {
        --boxel-button-color: var(--destructive, var(--boxel-danger));
        --boxel-button-text-color: var(
          --destructive-foreground,
          var(--boxel-light-100)
        );
      }
      .kind-destructive:not(:disabled):hover,
      .kind-destructive:not(:disabled):active,
      .kind-danger:not(:disabled):hover,
      .kind-danger:not(:disabled):active {
        --boxel-button-color: var(--destructive, var(--boxel-danger-hover));
      }

      .kind-text-only {
        /* transparent background and border */
        --boxel-button-color: transparent;
        --boxel-button-text-color: inherit;
      }
      .kind-text-only:not(:disabled):hover,
      .kind-text-only:not(:disabled):active {
        --boxel-button-color: var(
          --accent,
          color-mix(in oklab, currentColor 10%, transparent)
        );
        --boxel-button-text-color: var(--accent-foreground, currentColor);
      }

      .kind-primary-dark {
        /* inverted background and foreground */
        --boxel-button-color: var(--foreground, var(--boxel-dark));
        --boxel-button-text-color: var(--background, var(--boxel-light));
      }
      .kind-primary-dark:not(:disabled):hover,
      .kind-primary-dark:not(:disabled):active {
        --boxel-button-color: color-mix(
          in oklab,
          var(--foreground, var(--boxel-dark)) 85%,
          transparent
        );
      }

      .kind-secondary-light {
        /* transparent on light background */
        --boxel-button-color: transparent;
        --boxel-button-text-color: var(--foreground, var(--boxel-dark));
        --boxel-button-border: 1px solid
          var(--border, var(--boxel-button-border-color));
      }
      .kind-secondary-dark {
        /* transparent on dark background */
        --boxel-button-color: transparent;
        --boxel-button-text-color: var(--background, var(--boxel-light));
        --boxel-button-border: 1px solid
          var(--border, var(--boxel-button-border-color));
      }
      .kind-secondary-light:not(:disabled):hover,
      .kind-secondary-light:not(:disabled):active,
      .kind-secondary-dark:not(:disabled):hover,
      .kind-secondary-dark:not(:disabled):active {
        --boxel-button-border: 1px solid var(--boxel-button-text-color);
      }

      /**
      * Size variants - variants that control the size and spacing of a button
      *
      * The @size argument on the button component should create a corresponding class with format
      * size-@size
      *
      * Classes for the @size argument can control the following properties:
      *
      * --boxel-button-padding
      * --boxel-button-min-width
      * --boxel-button-min-height
      * --boxel-button-font
      * --boxel-button-letter-spacing
      * --boxel-loading-indicator-size
      *
      */

      .size-extra-small {
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-button-min-height: var(--boxel-button-xs);
        --boxel-button-min-width: 5rem;
        --boxel-button-loading-icon-size: var(--boxel-icon-xxs);
        --boxel-button-font: 700 var(--boxel-font-xs);
        --boxel-button-letter-spacing: var(--boxel-lsp-lg);
      }
      .size-extra-small.rectangular {
        border-radius: var(--boxel-border-radius-sm);
      }

      .size-small {
        --boxel-button-padding: var(--boxel-sp-4xs) var(--boxel-sp-sm);
        --boxel-button-min-height: var(--boxel-button-sm);
        --boxel-button-min-width: 5rem;
      }
      .size-small.rectangular {
        border-radius: var(--boxel-border-radius-sm);
      }

      .size-base {
        --boxel-button-padding: var(--boxel-sp-4xs) var(--boxel-sp-xl);
        --boxel-button-min-height: var(--boxel-button-sm);
        --boxel-button-min-width: 5rem;
      }

      /* tall but thinner button */
      .size-tall {
        --boxel-button-padding: var(--boxel-sp-xxs) var(--boxel-sp-lg);
        --boxel-button-min-height: var(--boxel-button-tall);
        --boxel-button-min-width: 5rem;
      }

      /*
        extra tall button mainly used in mobile screens
        touchable as it's bigger
        */
      .size-touch {
        --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
        --boxel-button-min-height: var(--boxel-button-touch);
        --boxel-button-min-width: 5rem;
        --boxel-button-loading-icon-size: var(--boxel-icon-sm);
        --boxel-button-font: 700 var(--boxel-font);
        --boxel-button-letter-spacing: var(--boxel-lsp-xs);
      }

      /* auto size properties & smallest padding size */
      .size-auto {
        --boxel-button-padding: 2px;
      }
    }
  </style>
</template>;

export default ButtonComponent;
