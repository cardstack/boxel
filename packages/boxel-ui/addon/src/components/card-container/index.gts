import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import Moon from '@cardstack/boxel-icons/moon';
import Sun from '@cardstack/boxel-icons/sun';

import IconButton from '../icon-button/index.gts';
import {
  and,
  bool,
  cn,
  element,
  sanitizeHtml,
  sanitizeHtmlSafe,
  extractCssVariables,
} from '../../helpers.ts';

interface Signature {
  Args: {
    cssImports?: string[];
    displayBoundaries?: boolean;
    isDarkMode?: boolean;
    tag?: keyof HTMLElementTagNameMap;
    themeVariables?: string;
    canToggleMode?: boolean;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const getThemeStyles = (css?: string, isDarkMode?: boolean) => {
  let selector = isDarkMode ? '.dark' : ':root';
  return sanitizeHtmlSafe(extractCssVariables(css, selector));
};

export default class CardContainer extends Component<Signature> {
  @tracked isDarkMode = this.args.isDarkMode ?? false;

  private toggleMode = () => {
    this.isDarkMode = !this.isDarkMode;
  };

  <template>
    {{#let (element @tag) as |Tag|}}
      <Tag
        class={{cn
          'boxel-card-container'
          boxel-card-container--boundaries=@displayBoundaries
          boxel-card-container--themed=(bool @themeVariables)
        }}
        style={{if
          @themeVariables
          (getThemeStyles @themeVariables this.isDarkMode)
        }}
        data-test-boxel-card-container
        ...attributes
      >
        {{#if (and @canToggleMode (bool @themeVariables))}}
          <IconButton
            class='mode-toggle'
            @variant='secondary'
            @round={{true}}
            @icon={{if this.isDarkMode Sun Moon}}
            {{on 'click' this.toggleMode}}
            aria-label='Toggle mode to {{if this.isDarkMode "light" "dark"}}'
          />
        {{/if}}
        {{yield}}
        {{#if @cssImports.length}}
          {{! template-lint-disable require-scoped-style  }}
          <style>
          {{#each @cssImports as |url|}}
              @import url('{{sanitizeHtml url}}');
            {{/each}}
        </style>
          {{! template-lint-enable require-scoped-style  }}
        {{/if}}
      </Tag>
    {{/let}}

    {{! Note: styles for this component use :global to avoid issues with
      cached HTML if this component changes. This is important because it
      ends up in nearly every card's prerendered HTML
  }}
    <style scoped>
      :global(.boxel-card-container) {
        position: relative;
        background-color: var(--background, var(--boxel-light));
        border-radius: var(--radius, var(--boxel-border-radius));
        color: var(--foreground, var(--boxel-dark));
        transition:
          max-width var(--boxel-transition),
          box-shadow var(--boxel-transition);
        height: 100%;
        width: 100%;
        overflow: hidden;
      }
      :global(.boxel-card-container--boundaries) {
        box-shadow: 0 0 0 1px var(--border, var(--boxel-border-color));
      }
      :global(.boxel-card-container--boundaries.hide-boundaries) {
        box-shadow: none;
      }
      :global(.mode-toggle) {
        position: absolute;
        top: var(--boxel-sp-xs);
        right: var(--boxel-sp-xs);
        z-index: 1;
        transition: none;
      }

      :global(.boxel-card-container--themed) {
        --_theme-heading-font-size: var(
          --brand-heading-font-size,
          var(--theme-heading-font-size)
        );
        --_theme-heading-font-family: var(
          --brand-heading-font-family,
          var(--theme-heading-font-family)
        );
        --_theme-heading-font-weight: var(
          --brand-heading-font-weight,
          var(--theme-heading-font-weight)
        );
        --_theme-heading-line-height: var(
          --brand-heading-line-height,
          var(--theme-heading-line-height)
        );

        --_theme-section-heading-font-size: var(
          --brand-section-heading-font-size,
          var(--theme-section-heading-font-size)
        );
        --_theme-section-heading-font-family: var(
          --brand-section-heading-font-family,
          var(--theme-section-heading-font-family)
        );
        --_theme-section-heading-font-weight: var(
          --brand-section-heading-font-weight,
          var(--theme-section-heading-font-weight)
        );
        --_theme-section-heading-line-height: var(
          --brand-section-heading-line-height,
          var(--theme-section-heading-line-height)
        );

        --_theme-subheading-font-size: var(
          --brand-subheading-font-size,
          var(--theme-subheading-font-size)
        );
        --_theme-subheading-font-family: var(
          --brand-subheading-font-family,
          var(--theme-subheading-font-family)
        );
        --_theme-subheading-font-weight: var(
          --brand-subheading-font-weight,
          var(--theme-subheading-font-weight)
        );
        --_theme-subheading-line-height: var(
          --brand-subheading-line-height,
          var(--theme-subheading-line-height)
        );

        --_theme-body-font-size: var(
          --brand-body-font-size,
          var(--theme-body-font-size)
        );
        --_theme-body-font-family: var(
          --brand-body-font-family,
          var(--theme-body-font-family)
        );
        --_theme-body-font-weight: var(
          --brand-body-font-weight,
          var(--theme-body-font-weight)
        );
        --_theme-body-line-height: var(
          --brand-body-line-height,
          var(--theme-body-line-height)
        );

        --_theme-caption-font-size: var(
          --brand-caption-font-size,
          var(--theme-caption-font-size)
        );
        --_theme-caption-font-family: var(
          --brand-caption-font-family,
          var(--theme-caption-font-family)
        );
        --_theme-caption-font-weight: var(
          --brand-caption-font-weight,
          var(--theme-caption-font-weight)
        );
        --_theme-caption-line-height: var(
          --brand-caption-line-height,
          var(--theme-caption-line-height)
        );

        /* setting boxel base css variable overrides, with boxel defaults as fallback */
        --_theme-spacing: calc(var(--spacing) * 4);
        --boxel-font-size: var(
          --_theme-body-font-size,
          var(--_boxel-font-size)
        );
        --boxel-spacing: var(--_theme-spacing, var(--_boxel-spacing));
        --boxel-radius: var(--radius, var(--_boxel-radius));

        --boxel-heading-font-family: var(
          --_theme-heading-font-family,
          var(--font-sans, var(--boxel-font-family))
        );
        --boxel-heading-font-size: var(
          --_theme-heading-font-size,
          var(--boxel-font-size-lg)
        );
        --boxel-heading-line-height: var(
          --_theme-heading-line-height,
          var(--boxel-line-height-lg)
        );
        --boxel-heading-font-weight: var(--_theme-heading-font-weight, 700);

        --boxel-section-heading-font-family: var(
          --_theme-section-heading-font-family,
          var(--font-sans, var(--boxel-font-family))
        );
        --boxel-section-heading-font-size: var(
          --_theme-section-heading-font-size,
          var(--boxel-font-size-md)
        );
        --boxel-section-heading-line-height: var(
          --_theme-section-heading-line-height,
          var(--boxel-line-height-md)
        );
        --boxel-section-heading-font-weight: var(
          --_theme-section-heading-font-weight,
          500
        );

        --boxel-subheading-font-family: var(
          --_theme-subheading-font-family,
          var(--font-sans, var(--boxel-font-family))
        );
        --boxel-subheading-font-size: var(
          --_theme-subheading-font-size,
          var(--boxel-font-size)
        );
        --boxel-subheading-line-height: var(
          --_theme-subheading-line-height,
          var(--boxel-line-height)
        );
        --boxel-subheading-font-weight: var(
          --_theme-subheading-font-weight,
          500
        );

        --boxel-body-font-family: var(
          --_theme-body-font-family,
          var(--font-sans, var(--boxel-font-family))
        );
        --boxel-body-font-size: var(
          --_theme-body-font-size,
          var(--boxel-font-size-sm)
        );
        --boxel-body-line-height: var(
          --_theme-body-line-height,
          var(--boxel-line-height-sm)
        );
        --boxel-body-font-weight: var(--_theme-body-font-weight, 400);

        --boxel-caption-font-family: var(
          --_theme-caption-font-family,
          var(--font-sans, var(--boxel-font-family))
        );
        --boxel-caption-font-size: var(
          --_theme-caption-font-size,
          var(--boxel-font-size-xs)
        );
        --boxel-caption-line-height: var(
          --_theme-caption-line-height,
          var(--boxel-line-height-xs)
        );
        --boxel-caption-font-weight: var(--_theme-caption-font-weight, 500);

        /*** code below this line is from "variables.css". values will be recalculated based on theming variable values ***/
        /* font-sizes */
        --boxel-font-size-2xl: calc(var(--boxel-font-size) * 2.25);
        --boxel-font-size-xl: calc(var(--boxel-font-size) * 2);
        --boxel-font-size-lg: calc(var(--boxel-font-size) * 1.375);
        --boxel-font-size-md: calc(var(--boxel-font-size) * 1.25);
        --boxel-font-size-sm: calc(var(--boxel-font-size) * 0.875);
        --boxel-font-size-xs: calc(var(--boxel-font-size) * 0.75);
        /* spacing */
        --boxel-sp-6xs: calc(var(--boxel-sp-5xs) / var(--boxel-ratio));
        --boxel-sp-5xs: calc(var(--boxel-sp-4xs) / var(--boxel-ratio));
        --boxel-sp-4xs: calc(var(--boxel-sp-3xs) / var(--boxel-ratio));
        --boxel-sp-3xs: calc(var(--boxel-sp-2xs) / var(--boxel-ratio));
        --boxel-sp-2xs: calc(var(--boxel-sp-xs) / var(--boxel-ratio));
        --boxel-sp-xs: calc(var(--boxel-sp-sm) / var(--boxel-ratio));
        --boxel-sp-sm: calc(var(--boxel-sp) / var(--boxel-ratio));
        --boxel-sp: var(--boxel-spacing); /* base */
        --boxel-sp-lg: calc(var(--boxel-sp) * var(--boxel-ratio));
        --boxel-sp-xl: calc(var(--boxel-sp-lg) * var(--boxel-ratio));
        --boxel-sp-2xl: calc(var(--boxel-sp-xl) * var(--boxel-ratio));
        --boxel-sp-3xl: calc(var(--boxel-sp-2xl) * var(--boxel-ratio));
        --boxel-sp-4xl: calc(var(--boxel-sp-3xl) * var(--boxel-ratio));
        --boxel-sp-5xl: calc(var(--boxel-sp-4xl) * var(--boxel-ratio));
        --boxel-sp-6xl: calc(var(--boxel-sp-5xl) * var(--boxel-ratio));
        /* border-radius */
        --boxel-border-radius-xxs: calc(var(--boxel-border-radius-xs) - 2.5px);
        --boxel-border-radius-xs: calc(var(--boxel-border-radius-sm) - 3px);
        --boxel-border-radius-sm: calc(var(--boxel-border-radius) - 3px);
        --boxel-border-radius: var(--boxel-radius); /* base */
        --boxel-border-radius-lg: calc(var(--boxel-border-radius) + 2px);
        --boxel-border-radius-xl: calc(var(--boxel-border-radius-lg) + 3px);
        --boxel-border-radius-xxl: calc(var(--boxel-border-radius-xl) + 5px);
        --boxel-form-control-border-radius: var(--boxel-border-radius);

        font-family: var(--boxel-body-font-family);
        font-size: var(--boxel-body-font-size);
        font-weight: var(--boxel-body-font-weight);
        letter-spacing: var(--tracking-normal);
        line-height: var(--boxel-body-line-height);
      }

      @layer reset {
        :global(h1),
        :global(h2),
        :global(h3),
        :global(h4),
        :global(h5),
        :global(h6),
        :global(p) {
          margin-inline-start: 0;
          margin-inline-end: 0;
          margin-block-start: 0;
          margin-block-end: 0;
        }

        :global(h1) {
          font-family: var(--boxel-heading-font-family);
          font-size: var(--boxel-heading-font-size);
          font-weight: var(--boxel-heading-font-weight);
          line-height: var(--boxel-heading-line-height);
        }
        :global(h2) {
          font-family: var(--boxel-section-heading-font-family);
          font-size: var(--boxel-section-heading-font-size);
          font-weight: var(--boxel-section-heading-font-weight);
          line-height: var(--boxel-section-heading-line-height);
        }
        :global(h3) {
          font-family: var(--boxel-subheading-font-family);
          font-size: var(--boxel-subheading-font-size);
          font-weight: var(--boxel-subheading-font-weight);
          line-height: var(--boxel-subheading-line-height);
        }
        :global(p) {
          font-family: var(--boxel-body-font-family);
          font-size: var(--boxel-body-font-size);
          font-weight: var(--boxel-body-font-weight);
          line-height: var(--boxel-body-line-height);
        }
        :global(small) {
          font-family: var(--boxel-caption-font-family);
          font-size: var(--boxel-caption-font-size);
          font-weight: var(--boxel-caption-font-weight);
          line-height: var(--boxel-caption-line-height);
        }
      }
    </style>
  </template>
}
