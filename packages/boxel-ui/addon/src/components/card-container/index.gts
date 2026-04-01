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
      background-color: var(--boxel-light);
      border-radius: var(--boxel-border-radius);
      color: var(--boxel-dark);
      transition:
        max-width var(--boxel-transition),
        box-shadow var(--boxel-transition);
      height: 100%;
      width: 100%;
      overflow: hidden;
    }
    :global(.boxel-card-container--boundaries:not(.hide-boundaries)) {
      box-shadow: 0 0 0 1px var(--boxel-border-color);
    }

    :global(.boxel-card-container--themed) {
      /* setting boxel base css variable overrides, with boxel defaults as fallback */
      --theme-spacing: calc(var(--spacing) * 4);
      --_sp-scale: var(--theme-spacing-ratio, var(--boxel-ratio));
      --boxel-font-size: var(--theme-body-font-size, var(--_boxel-font-size));
      --boxel-spacing: var(--theme-spacing, var(--_boxel-spacing));
      --boxel-radius: var(--radius, var(--_boxel-radius));

      --boxel-heading-font-family: var(
        --theme-heading-font-family,
        var(--font-sans, var(--boxel-font-family))
      );
      --boxel-heading-font-size: var(
        --theme-heading-font-size,
        var(--boxel-font-size-lg)
      );
      --boxel-heading-line-height: var(
        --theme-heading-line-height,
        var(--boxel-line-height-lg)
      );
      --boxel-heading-font-weight: var(--theme-heading-font-weight, 700);

      --boxel-section-heading-font-family: var(
        --theme-section-heading-font-family,
        var(--font-sans, var(--boxel-font-family))
      );
      --boxel-section-heading-font-size: var(
        --theme-section-heading-font-size,
        var(--boxel-font-size-md)
      );
      --boxel-section-heading-line-height: var(
        --theme-section-heading-line-height,
        var(--boxel-line-height-md)
      );
      --boxel-section-heading-font-weight: var(
        --theme-section-heading-font-weight,
        500
      );

      --boxel-subheading-font-family: var(
        --theme-subheading-font-family,
        var(--font-sans, var(--boxel-font-family))
      );
      --boxel-subheading-font-size: var(
        --theme-subheading-font-size,
        var(--boxel-font-size)
      );
      --boxel-subheading-line-height: var(
        --theme-subheading-line-height,
        var(--boxel-line-height)
      );
      --boxel-subheading-font-weight: var(--theme-subheading-font-weight, 500);

      --boxel-body-font-family: var(
        --theme-body-font-family,
        var(--font-sans, var(--boxel-font-family))
      );
      --boxel-body-font-size: var(
        --theme-body-font-size,
        var(--boxel-font-size-sm)
      );
      --boxel-body-line-height: var(
        --theme-body-line-height,
        var(--boxel-line-height-sm)
      );
      --boxel-body-font-weight: var(--theme-body-font-weight, 400);

      --boxel-caption-font-family: var(
        --theme-caption-font-family,
        var(--font-sans, var(--boxel-font-family))
      );
      --boxel-caption-font-size: var(
        --theme-caption-font-size,
        var(--boxel-font-size-xs)
      );
      --boxel-caption-line-height: var(
        --theme-caption-line-height,
        var(--boxel-line-height-xs)
      );
      --boxel-caption-font-weight: var(--theme-caption-font-weight, 500);

      /*** code below this line is from "variables.css". values will be recalculated based on theming variable values ***/
      /* spacing */
      --boxel-sp-6xs: calc(var(--boxel-sp-5xs) / var(--_sp-scale));
      --boxel-sp-5xs: calc(var(--boxel-sp-4xs) / var(--_sp-scale));
      --boxel-sp-4xs: calc(var(--boxel-sp-3xs) / var(--_sp-scale));
      --boxel-sp-3xs: calc(var(--boxel-sp-2xs) / var(--_sp-scale));
      --boxel-sp-2xs: calc(var(--boxel-sp-xs) / var(--_sp-scale));
      --boxel-sp-xs: calc(var(--boxel-sp-sm) / var(--_sp-scale));
      --boxel-sp-sm: calc(var(--boxel-sp) / var(--_sp-scale));
      --boxel-sp: var(--boxel-spacing); /* base */
      --boxel-sp-lg: calc(var(--boxel-sp) * var(--_sp-scale));
      --boxel-sp-xl: calc(var(--boxel-sp-lg) * var(--_sp-scale));
      --boxel-sp-2xl: calc(var(--boxel-sp-xl) * var(--_sp-scale));
      --boxel-sp-3xl: calc(var(--boxel-sp-2xl) * var(--_sp-scale));
      --boxel-sp-4xl: calc(var(--boxel-sp-3xl) * var(--_sp-scale));
      --boxel-sp-5xl: calc(var(--boxel-sp-4xl) * var(--_sp-scale));
      --boxel-sp-6xl: calc(var(--boxel-sp-5xl) * var(--_sp-scale));
      /* border-radius */
      --boxel-border-radius-xxs: calc(var(--boxel-border-radius-xs) - 2.5px);
      --boxel-border-radius-xs: calc(var(--boxel-border-radius-sm) - 3px);
      --boxel-border-radius-sm: calc(var(--boxel-border-radius) - 3px);
      --boxel-border-radius: var(--boxel-radius); /* base */
      --boxel-border-radius-lg: calc(var(--boxel-border-radius) + 2px);
      --boxel-border-radius-xl: calc(var(--boxel-border-radius-lg) + 3px);
      --boxel-border-radius-xxl: calc(var(--boxel-border-radius-xl) + 5px);
      --boxel-form-control-border-radius: var(--boxel-border-radius);

      background-color: var(--background, var(--boxel-light));
      border-radius: var(--radius, var(--boxel-border-radius));
      color: var(--foreground, var(--boxel-dark));
      font-family: var(--boxel-body-font-family);
      font-size: var(--boxel-body-font-size);
      font-weight: var(--boxel-body-font-weight);
      letter-spacing: var(--tracking-normal);
      line-height: var(--boxel-body-line-height);
    }

    :global(
      .boxel-card-container--themed.boxel-card-container--boundaries:not(
          .hide-boundaries
        )
    ) {
      box-shadow: 0 0 0 1px var(--border, var(--boxel-border-color));
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
        font-size: var(--boxel-caption-font-size);
        line-height: var(--boxel-caption-line-height);
      }
    }
  </style>
</template>;

export default CardContainer;
