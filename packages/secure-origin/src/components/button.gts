// boxel-ui's Button: a <button>, or with `@as='anchor'` an <a>, drawn by
// kind and size, with a loading indicator while `@loading`. boxel-ui's
// `link-to` form, which needs the app's router, is left out. The scoped rules
// are boxel-ui's own, copied in.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';

import LoadingIndicator from './loading-indicator.gts';

export type ButtonKind =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'destructive'
  | 'text-only'
  | 'primary-dark'
  | 'link'
  | 'link-primary'
  | 'link-muted';

export type ButtonSize =
  | 'auto'
  | 'extra-small'
  | 'small'
  | 'base'
  | 'tall'
  | 'touch';

interface Signature {
  Args: {
    as?: 'button' | 'anchor';
    disabled?: boolean;
    href?: string;
    kind?: ButtonKind;
    loading?: boolean;
    pill?: boolean;
    rectangular?: boolean;
    size?: ButtonSize;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

function classes(
  size: ButtonSize | undefined,
  kind: ButtonKind | undefined,
  states: { loading?: boolean; rectangular?: boolean; pill?: boolean },
): string {
  return [
    'boxel-button',
    `size-${size ?? 'base'}`,
    `kind-${kind ?? 'default'}`,
    ...Object.entries(states)
      .filter(([, on]) => on)
      .map(([name]) => name),
  ].join(' ');
}

function isAnchor(as: string | undefined): boolean {
  return as === 'anchor';
}

const Button: TemplateOnlyComponent<Signature> = <template>
  {{#let
    (classes
      @size @kind (hash loading=@loading rectangular=@rectangular pill=@pill)
    )
    as |classNames|
  }}
    {{#if (isAnchor @as)}}
      {{! An <a> with no href is not a link: it maps to the generic role, where
          aria-disabled is dropped. role='link' is what makes the disabled
          state reach assistive tech. }}
      <a
        class={{classNames}}
        href={{unless @disabled @href}}
        role={{if @disabled 'link'}}
        aria-disabled={{if @disabled 'true'}}
        data-test-boxel-button
        ...attributes
      >
        {{yield}}
      </a>
    {{else}}
      {{! type='button' comes before ...attributes, so it is only the default:
          a caller's type='submit' wins. }}
      <button
        class={{classNames}}
        aria-label={{if @loading 'loading'}}
        {{! 'true', not the raw boolean: Glimmer renders a bare true as
            aria-disabled="", which ARIA reads as false. }}
        aria-disabled={{if @disabled 'true'}}
        disabled={{@disabled}}
        data-test-boxel-button
        type='button'
        ...attributes
      >
        {{#if @loading}}
          <LoadingIndicator
            class='loading-indicator'
            data-test-boxel-button-loading-indicator
          />
        {{/if}}
        {{yield}}
      </button>
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
        border-radius: var(--boxel-button-border-radius, 100px);
      }
      .boxel-button:is(.pill) {
        border-radius: var(
          --boxel-button-border-radius,
          var(--boxel-border-radius-pill)
        );
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
        /* boxel-ui passes this as the indicator's @color. */
        --boxel-loading-indicator-color: var(--boxel-button-text-color);
        margin-right: var(
          --boxel-button-loading-indicator-gap,
          var(--boxel-sp-xxs)
        );
      }

      /* select disabled buttons and links that don't have href */

      .boxel-button:disabled:not(.loading),
      a.boxel-button:not([href]),
      a.boxel-button[href=''] {
        --boxel-button-box-shadow: none;
        background-color: var(
          --boxel-button-disabled-background,
          var(--boxel-button-color)
        );
        border: var(--boxel-button-disabled-border, var(--boxel-button-border));
        color: var(
          --boxel-button-disabled-foreground,
          var(--boxel-button-text-color)
        );
        opacity: var(--boxel-button-disabled-opacity, 0.5);
        cursor: default;
      }

      /* the a element does not have a disabled attribute. Clicking will still trigger event listeners */
      a.boxel-button:not([href]),
      a.boxel-button[href=''] {
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
        --boxel-button-color: var(
          --boxel-button-default-background,
          var(--background)
        );
        --boxel-button-text-color: var(
          --boxel-button-default-foreground,
          var(--foreground)
        );
        --boxel-button-border: 1px solid
          var(--boxel-button-default-border, var(--border));
      }
      .kind-default:not(:disabled):hover,
      .kind-default:not(:disabled):active {
        --boxel-button-color: var(
          --boxel-button-default-active-background,
          var(--accent)
        );
        --boxel-button-text-color: var(
          --boxel-button-default-active-foreground,
          var(--accent-foreground)
        );
        --boxel-button-border: 1px solid
          var(--boxel-button-default-active-border, var(--border));
      }

      .kind-primary {
        --boxel-button-color: var(
          --boxel-button-primary-background,
          var(--primary)
        );
        --boxel-button-text-color: var(
          --boxel-button-primary-foreground,
          var(--primary-foreground)
        );
      }
      .kind-primary:not(:disabled):hover,
      .kind-primary:not(:disabled):active {
        --boxel-button-color: var(
          --boxel-button-primary-active-background,
          var(--primary)
        );
      }

      .kind-secondary {
        --boxel-button-color: var(
          --boxel-button-secondary-background,
          var(--secondary)
        );
        --boxel-button-text-color: var(
          --boxel-button-secondary-foreground,
          var(--secondary-foreground)
        );
        --boxel-button-border: 1px solid
          var(--boxel-button-secondary-border, var(--secondary));
      }
      .kind-secondary:not(:disabled):hover,
      .kind-secondary:not(:disabled):active {
        --boxel-button-border: 1px solid
          var(--boxel-button-secondary-active-border, var(--secondary));
      }

      .kind-muted {
        --boxel-button-color: var(--muted);
        --boxel-button-text-color: var(--foreground);
      }
      .kind-muted:not(:disabled):hover {
        background-color: color-mix(
          in oklab,
          var(--muted) 96%,
          var(--foreground)
        );
      }

      .kind-destructive {
        --boxel-button-color: var(--destructive);
        --boxel-button-text-color: var(--destructive-foreground);
      }
      .kind-destructive:not(:disabled):hover,
      .kind-destructive:not(:disabled):active {
        --boxel-button-color: var(
          --boxel-button-destructive-active-background,
          var(--destructive)
        );
      }

      .kind-text-only {
        /* transparent background and border */
        --boxel-button-color: var(--boxel-button-ghost-background, transparent);
        --boxel-button-text-color: var(
          --boxel-button-ghost-foreground,
          inherit
        );
      }
      .kind-text-only:not(:disabled):hover,
      .kind-text-only:not(:disabled):active {
        --boxel-button-color: color-mix(
          in oklab,
          currentColor 10%,
          transparent
        );
        --boxel-button-text-color: currentColor;
      }

      .kind-primary-dark {
        /* always dark */
        --boxel-button-color: var(--boxel-dark);
        --boxel-button-text-color: var(--boxel-light);
      }
      .kind-primary-dark:not(:disabled):hover,
      .kind-primary-dark:not(:disabled):active {
        --boxel-button-color: color-mix(
          in oklab,
          var(--boxel-dark) 80%,
          var(--boxel-light)
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
      * --boxel-loading-indicator-size
      *
      */

      .size-extra-small {
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-button-min-height: var(--boxel-button-xs);
        --boxel-button-min-width: 5rem;
        --boxel-button-loading-icon-size: var(--boxel-icon-2xs);
        --boxel-button-font: 500 var(--boxel-font-xs);
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
        --boxel-button-padding: var(--boxel-sp-2xs) var(--boxel-sp-lg);
        --boxel-button-min-height: var(--boxel-button-tall);
        --boxel-button-min-width: 5rem;
        --boxel-button-letter-spacing: var(--boxel-lsp-xs);
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
        --boxel-button-font: 600 var(--boxel-font);
        --boxel-button-letter-spacing: var(--boxel-lsp-xs);
      }

      /* auto size properties & smallest padding size */
      .size-auto {
        --boxel-button-padding: 2px;
      }

      .boxel-button.kind-link,
      .boxel-button.kind-link-primary,
      .boxel-button.kind-link-muted {
        min-height: initial;
        min-width: initial;
        padding-block: 0;
        padding-inline: 0;
        background: none;
        border: none;
        border-radius: var(--boxel-border-radius-xs);
        font-family: inherit;
        font-weight: inherit;
        line-height: inherit;
        letter-spacing: inherit;
        box-shadow: none;
      }
      .boxel-button.kind-link {
        color: var(--boxel-button-link-foreground, var(--foreground));
      }
      .boxel-button.kind-link:not(:disabled):hover,
      .boxel-button.kind-link:not(:disabled):active {
        color: var(--boxel-button-link-active-foreground, var(--foreground));
        text-decoration: underline;
      }
      .boxel-button.kind-link-primary {
        color: var(--boxel-button-link-primary-foreground, var(--primary));
      }
      .boxel-button.kind-link-primary:not(:disabled):hover,
      .boxel-button.kind-link-primary:not(:disabled):active {
        color: var(
          --boxel-button-link-primary-active-foreground,
          color-mix(in oklab, var(--primary) 80%, black)
        );
      }
      .boxel-button.kind-link-muted {
        color: var(
          --boxel-button-link-muted-foreground,
          var(--muted-foreground)
        );
      }
      .boxel-button.kind-link-muted:not(:disabled):hover,
      .boxel-button.kind-link-muted:not(:disabled):active {
        color: var(
          --boxel-button-link-muted-active-foreground,
          var(--foreground)
        );
      }
    }
  </style>
</template>;

export default Button;
