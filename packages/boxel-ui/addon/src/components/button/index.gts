import { array, concat, hash } from '@ember/helper';
import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';

import cn from '../../helpers/cn.ts';
import { eq, not, or } from '../../helpers/truth-helpers.ts';
import LoadingIndicator from '../loading-indicator/index.gts';

export type BoxelButtonKind =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'secondary-dark'
  | 'secondary-light'
  | 'outline'
  | 'danger'
  | 'primary-dark'
  | 'text-only';

export type BoxelButtonSize =
  | 'extra-small'
  | 'small'
  | 'base'
  | 'tall'
  | 'touch';

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
    route?: any;
    size?: BoxelButtonSize;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}
export default class ButtonComponent extends Component<Signature> {
  defaultSize: BoxelButtonSize = 'base';
  defaultKind: BoxelButtonKind = 'default';

  <template>
    {{#let
      (cn
        'boxel-button'
        @class
        (concat 'size-' (if @size @size this.defaultSize))
        (concat 'kind-' (if @kind @kind this.defaultKind))
      )
      as |classes|
    }}
      {{#if (or (not @as) (eq @as 'button'))}}
        <button
          class={{cn classes (if @loading 'loading')}}
          tabindex={{if @loading -1 0}}
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
      @layer {
        /* Button */
        .boxel-button {
          display: inline-flex;
          justify-content: center;
          height: min-content;
          align-items: center;
          border-radius: var(--radius, 100px);
          box-shadow: var(--shadow);
          transition:
            background-color var(--boxel-transition),
            border var(--boxel-transition),
            color var(--boxel-transition);

          /* kind variants + disabled state */
          border: var(
            --boxel-button-border,
            1px solid var(--border, var(--boxel-border-color))
          );
          color: var(--boxel-button-text-color, inherit);
          background-color: var(
            --boxel-button-color,
            var(--background, transparent)
          );

          /* size variants */
          font: var(--boxel-button-font, var(--boxel-font-sm));
          font-family: inherit;
          min-height: var(--boxel-button-min-height);
          min-width: var(--boxel-button-min-width, 5rem);
          padding: var(
            --boxel-button-padding,
            var(--boxel-sp-xs) var(--boxel-sp-sm)
          );
          letter-spacing: var(
            --boxel-button-letter-spacing,
            var(--boxel-lsp-lg)
          );
        }
        @supports (color: color-mix(in lab, red, red)) {
          .boxel-button:not(:disabled):hover,
          .boxel-button:not(:disabled):active {
            background-color: color-mix(
              in oklab,
              var(--boxel-button-color) 90%,
              transparent
            );
          }
        }

        .loading-indicator {
          width: var(--boxel-button-loading-icon-size);
          height: var(--boxel-button-loading-icon-size);
          margin-right: var(--boxel-sp-xxxs);
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
          --boxel-button-color: var(--boxel-button-border-color);
          --boxel-button-border: 1px solid var(--boxel-button-border-color);
          --boxel-button-text-color: var(--boxel-light);

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
        .kind-default {
          color: var(--primary, inherit);
        }
        .kind-default:hover {
          color: var(--primary, var(--boxel-button-text-color));
          border-color: currentColor;
        }

        /**
      * Kind variants - variants that control the colors on a button
      *
      * The @kind argument on the button component should create a corresponding class with format
      * kind-@kind
      *
      * Classes for the @kind argument can control the following properties:
      *
      * --boxel-button-color
      * --boxel-button-border
      * --boxel-button-text-color
      *
      */
        .kind-primary:not(:disabled) {
          /*
            background-color: var(--primary);
            color: var(--primary-foreground);
          */
          --boxel-button-color: var(--primary, var(--boxel-highlight));
          --boxel-button-border: 1px solid var(--boxel-button-color);
          --boxel-button-text-color: var(
            --primary-foreground,
            var(--boxel-dark)
          );
        }

        .kind-primary:not(:disabled):hover,
        .kind-primary:not(:disabled):active {
          --boxel-button-color: var(--primary, var(--boxel-highlight-hover));
        }

        .kind-secondary:not(:disabled) {
          --boxel-button-color: var(--secondary, var(--boxel-dark));
          --boxel-button-border: 1px solid var(--secondary, var(--boxel-dark));
          --boxel-button-text-color: var(
            --secondary-foreground,
            var(--boxel-light)
          );
        }
        .kind-secondary:not(:disabled):hover,
        .kind-secondary:not(:disabled):active {
          --boxel-button-border: 1px solid var(--secondary, var(--boxel-dark));
        }

        .kind-secondary-dark:not(:disabled) {
          /* transparent on dark background */
          --boxel-button-color: transparent;
          --boxel-button-border: 1px solid var(--border, var(--boxel-400));
          --boxel-button-text-color: var(--boxel-light);
        }

        .kind-secondary-dark:not(:disabled):hover,
        .kind-secondary-dark:not(:disabled):active {
          --boxel-button-border: 1px solid var(--boxel-light);
        }

        .kind-secondary-dark:disabled,
        a.kind-secondary-dark:not([href]),
        a.kind-secondary-dark[href=''],
        a.kind-secondary-dark.disabled-link {
          --boxel-button-color: transparent;
          opacity: 0.35;
        }

        .kind-outline:not(:disabled),
        .kind-secondary-light:not(:disabled) {
          /* transparent on light background */
          --boxel-button-color: var(--background, transparent);
          --boxel-button-border: 1px solid
            var(--border, var(--boxel-button-border-color));
          --boxel-button-text-color: var(--boxel-dark);
        }
        .kind-secondary-light:not(:disabled):hover,
        .kind-secondary-light:not(:disabled):active {
          --boxel-button-border: 1px solid var(--boxel-dark);
        }
        .kind-outline:not(:disabled) {
          --boxel-button-text-color: inherit;
        }
        .kind-outline:not(:disabled):hover,
        .kind-outline:not(:disabled):active {
          --boxel-button-color: var(--accent, var(--boxel-highlight));
          --boxel-button-text-color: var(
            --accent-foreground,
            var(--boxel-dark)
          );
        }

        .kind-danger:not(:disabled) {
          --boxel-button-color: var(--destructive, var(--boxel-danger));
          --boxel-button-border: 1px solid var(--boxel-button-color);
          --boxel-button-text-color: var(
            --destructive-foreground,
            var(--boxel-light)
          );
        }

        .kind-danger:not(:disabled):hover,
        .kind-danger:not(:disabled):active {
          --boxel-button-border: 1px solid var(--boxel-danger-hover);
          --boxel-button-color: var(--boxel-danger-hover);
        }

        .kind-primary-dark:not(:disabled) {
          --boxel-button-color: var(--boxel-dark);
          --boxel-button-border: 1px solid var(--boxel-dark);
          --boxel-button-text-color: var(--boxel-light);
        }

        .kind-primary-dark:not(:disabled):hover,
        .kind-primary-dark:not(:disabled):active {
          --boxel-button-border: 1px solid var(--boxel-purple-800);
          --boxel-button-color: var(--boxel-purple-800);
        }

        .kind-text-only:not(:disabled) {
          --boxel-button-color: transparent;
          --boxel-button-border: 1px solid transparent;
          --boxel-button-letter-spacing: var(--boxel-lsp-xs);
          --boxel-button-text-color: inherit;
          box-shadow: none;
        }

        .kind-text-only:not(:disabled):hover {
          --boxel-button-color: var(--accent, var(--boxel-200));
          --boxel-button-text-color: var(
            --accent-foreground,
            var(--boxel-dark)
          );
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
      * --boxel-button-loading-icon-size
      *
      */

        .size-extra-small {
          --boxel-button-padding: var(--boxel-sp-xxxs) var(--boxel-sp);
          --boxel-button-font: var(--boxel-font-xs);
          --boxel-button-loading-icon-size: var(--boxel-font-size-xs);
          --boxel-button-letter-spacing: var(--boxel-lsp-lg);
          --boxel-button-min-height: 1.8125rem;
        }

        /* thinner base button */
        .size-small {
          --boxel-button-padding: var(--boxel-sp-xxxs) var(--boxel-sp-sm);
          --boxel-button-font: 600 var(--boxel-font-sm);
          --boxel-button-loading-icon-size: var(--boxel-font-size-sm);
          --boxel-button-letter-spacing: var(--boxel-lsp);
          --boxel-button-min-height: 2rem;
        }

        .size-base {
          --boxel-button-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xl);
          --boxel-button-font: 600 var(--boxel-font-sm);
          --boxel-button-loading-icon-size: var(--boxel-font-size-sm);
          --boxel-button-letter-spacing: var(--boxel-lsp);
          --boxel-button-min-height: 2rem;
        }

        /* tall but thinner button */
        .size-tall {
          --boxel-button-padding: var(--boxel-sp-xxs) var(--boxel-sp);
          --boxel-button-font: 600 var(--boxel-font-sm);
          --boxel-button-loading-icon-size: var(--boxel-font-size-sm);
          --boxel-button-letter-spacing: var(--boxel-lsp);
          --boxel-button-min-height: 2.5rem;
        }

        /*
        extra tall button mainly used in mobile screens
        touchable as it's bigger
        */
        .size-touch {
          --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
          --boxel-button-font: 600 var(--boxel-font);
          --boxel-button-loading-icon-size: var(--boxel-font-size);
          --boxel-button-letter-spacing: var(--boxel-lsp-xs);
          --boxel-button-min-height: 3rem;
        }
      }
    </style>
  </template>
}
