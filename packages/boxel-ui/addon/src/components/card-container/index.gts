import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import element from '../../helpers/element.ts';
import { sanitizeHtml } from '../../helpers/sanitize-html.ts';

interface Signature {
  Args: {
    cssImports?: string[];
    displayBoundaries?: boolean;
    isThemed?: boolean;
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const CardContainer: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag
      class={{cn
        'boxel-card-container'
        boxel-card-container--boundaries=@displayBoundaries
        boxel-card-container--themed=@isThemed
      }}
      data-test-boxel-card-container
      ...attributes
    >
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
      border-radius: var(--boxel-border-radius);
      color: var(--foreground, var(--boxel-dark));
      transition:
        max-width var(--boxel-transition),
        box-shadow var(--boxel-transition);
      height: 100%;
      width: 100%;
      overflow: hidden;
    }
    :global(.boxel-card-container--boundaries) {
      box-shadow:
        0 0 0 1px var(--border, var(--boxel-border-color)),
        var(--shadow, 0 0 0 1px var(--boxel-border-color));
    }
    :global(.boxel-card-container--boundaries.hide-boundaries) {
      box-shadow: none;
    }

    :global(.boxel-card-container--themed) {
      /* convert variable names */
      --theme-spacing: calc(var(--spacing) * 4);
      --typescale-h1: var(--brand-heading-font-size);
      --typescale-body: var(--brand-body-font-size);
      --font-family-base: var(--brand-body-font-family);
      --font-weight-body: var(--brand-body-font-weight);
      --lineheight-base: var(--brand-body-line-height);
      /* setting boxel base css variable overrides, with boxel defaults as fallback */
      --boxel-font-size: var(--typescale-body, var(--_boxel-font-size));
      --boxel-spacing: var(--theme-spacing, var(--_boxel-spacing));
      --boxel-radius: var(--radius, var(--_boxel-radius));

      /*** code below this line is from "variables.css". values will be recalculated based on theming variable values ***/
      /* font-sizes */
      --boxel-font-size-xxl: calc(var(--boxel-font-size) * 2.5);
      --boxel-font-size-xl: calc(var(--boxel-font-size) * 2);
      --boxel-font-size-lg: calc(var(--boxel-font-size) * 1.375);
      --boxel-font-size-med: calc(var(--boxel-font-size) * 1.25);
      --boxel-font-size-sm: calc(var(--boxel-font-size) * 0.8125);
      --boxel-font-size-xs: calc(var(--boxel-font-size) * 0.6875);
      /* spacing */
      --boxel-sp-6xs: calc(var(--boxel-sp-5xs) / var(--boxel-ratio));
      --boxel-sp-5xs: calc(var(--boxel-sp-4xs) / var(--boxel-ratio));
      --boxel-sp-4xs: calc(var(--boxel-sp-xxxs) / var(--boxel-ratio));
      --boxel-sp-xxxs: calc(var(--boxel-sp-xxs) / var(--boxel-ratio));
      --boxel-sp-xxs: calc(var(--boxel-sp-xs) / var(--boxel-ratio));
      --boxel-sp-xs: calc(var(--boxel-sp-sm) / var(--boxel-ratio));
      --boxel-sp-sm: calc(var(--boxel-sp) / var(--boxel-ratio));
      --boxel-sp: var(--boxel-spacing); /* base */
      --boxel-sp-lg: calc(var(--boxel-sp) * var(--boxel-ratio));
      --boxel-sp-xl: calc(var(--boxel-sp-lg) * var(--boxel-ratio));
      --boxel-sp-xxl: calc(var(--boxel-sp-xl) * var(--boxel-ratio));
      --boxel-sp-xxxl: calc(var(--boxel-sp-xxl) * var(--boxel-ratio));
      /* border-radius */
      --boxel-border-radius-xxs: calc(var(--boxel-border-radius-xs) - 2.5px);
      --boxel-border-radius-xs: calc(var(--boxel-border-radius-sm) - 3px);
      --boxel-border-radius-sm: calc(var(--boxel-border-radius) - 3px);
      --boxel-border-radius: var(--boxel-radius); /* base */
      --boxel-border-radius-lg: calc(var(--boxel-border-radius) + 2px);
      --boxel-border-radius-xl: calc(var(--boxel-border-radius-lg) + 3px);
      --boxel-border-radius-xxl: calc(var(--boxel-border-radius-xl) + 5px);
      --boxel-form-control-border-radius: var(--boxel-border-radius);

      font-family: var(--font-family-base, var(--font-sans));
      font-size: var(--typescale-body);
      font-weight: var(--font-weight-body);
      letter-spacing: var(--tracking-normal);
      line-height: var(--lineheight-base);
      box-shadow: var(--shadow);
    }
  </style>
</template>;

export default CardContainer;
