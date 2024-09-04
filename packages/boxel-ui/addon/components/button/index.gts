import Component from '@glimmer/component';
import { array, concat, hash } from '@ember/helper';
import LoadingIndicator from '../loading-indicator';
import cn from '../../helpers/cn';
import { or, eq, not } from '../../helpers/truth-helpers';
import { LinkTo } from '@ember/routing';

interface Signature {
  Element: HTMLButtonElement | HTMLAnchorElement;
  Args: {
    as?: string;
    kind?: string;
    disabled?: boolean;
    loading?: boolean;
    route?: any;
    models?: any;
    query?: any;
    size?: string;
    href?: string;
    class?: string;
  };
  Blocks: {
    default: [];
  };
}
export default class ButtonComponent extends Component<Signature> {
  defaultSize = 'base';
  defaultKind = 'secondary-light';

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
    <style>
      @layer {
        /* Button */
        .boxel-button {
          display: inline-flex;
          justify-content: center;
          height: min-content;
          align-items: center;
          border-radius: 100px;
          white-space: nowrap;
          transition:
            background-color var(--boxel-transition),
            border var(--boxel-transition);

          /* kind variants + disabled state */
          border: var(--boxel-button-border, var(--boxel-border));
          color: var(--boxel-button-text-color, black);
          background-color: var(--boxel-button-color, transparent);

          /* size variants */
          font: var(--boxel-button-font, var(--boxel-font-sm));
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
      * --boxel-button-color
      * --boxel-button-border
      * --boxel-button-text-color
      *
      */
        .kind-primary:not(:disabled) {
          --boxel-button-color: var(--boxel-highlight);
          --boxel-button-border: 1px solid var(--boxel-button-color);
          --boxel-button-text-color: var(--boxel-dark);
        }

        .kind-primary:not(:disabled):hover,
        .kind-primary:not(:disabled):active {
          --boxel-button-color: var(--boxel-highlight-hover);
        }

        .kind-secondary-dark:not(:disabled) {
          /* transparent on dark background */
          --boxel-button-color: transparent;
          --boxel-button-border: 1px solid var(--boxel-purple-400);
          --boxel-button-text-color: var(--boxel-light);
        }

        .kind-secondary-dark:not(:disabled):hover,
        .kind-secondary-dark:not(:disabled):active {
          --boxel-button-border: 1px solid var(--boxel-light);
        }

        .kind-secondary-light:not(:disabled) {
          /* transparent on light background */
          --boxel-button-color: transparent;
          --boxel-button-border: 1px solid var(--boxel-button-border-color);
          --boxel-button-text-color: var(--boxel-dark);
        }

        .kind-secondary-light:not(:disabled):hover,
        .kind-secondary-light:not(:disabled):active {
          --boxel-button-border: 1px solid var(--boxel-dark);
        }

        .kind-danger:not(:disabled) {
          --boxel-button-color: var(--boxel-danger);
          --boxel-button-border: 1px solid var(--boxel-danger);
          --boxel-button-text-color: var(--boxel-light-100);
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
          --boxel-button-font: 700 var(--boxel-font-sm);
          --boxel-button-loading-icon-size: var(--boxel-font-size-sm);
          --boxel-button-letter-spacing: var(--boxel-lsp);
          --boxel-button-min-height: 2rem;
        }

        .size-base {
          --boxel-button-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xl);
          --boxel-button-font: 700 var(--boxel-font-sm);
          --boxel-button-loading-icon-size: var(--boxel-font-size-sm);
          --boxel-button-letter-spacing: var(--boxel-lsp);
          --boxel-button-min-height: 2rem;
        }

        /* tall but thinner button */
        .size-tall {
          --boxel-button-padding: var(--boxel-sp-xxs) var(--boxel-sp);
          --boxel-button-font: 700 var(--boxel-font-sm);
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
