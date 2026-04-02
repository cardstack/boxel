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
      border-radius: var(--radius, var(--boxel-border-radius));
      color: var(--foreground, var(--boxel-dark));
      transition:
        max-width var(--boxel-transition),
        box-shadow var(--boxel-transition);
      height: 100%;
      width: 100%;
      overflow: hidden;
    }
    :global(.boxel-card-container--boundaries:not(.hide-boundaries)) {
      box-shadow: 0 0 0 1px var(--border, var(--boxel-border-color));
    }

    :global(.boxel-card-container--themed) {
      /* setting boxel base css variable overrides, with boxel defaults as fallback */
      --_boxel-scale: var(--theme-scale, var(--boxel-ratio));
      --theme-spacing: calc(var(--spacing) * 4);
      --boxel-spacing: var(--theme-spacing, var(--_boxel-spacing));
      --boxel-font-size: var(
        --theme-font-size,
        var(--theme-body-font-size, var(--_boxel-font-size))
      );
      --boxel-radius: var(--radius, var(--_boxel-radius));

      /*** code below this line is from "variables.css". values will be recalculated based on theming variable values ***/
      /* font-sizes */
      --boxel-font-size-2xl: calc(var(--boxel-font-size) * 2.25);
      --boxel-font-size-xl: calc(var(--boxel-font-size) * 2);
      --boxel-font-size-lg: calc(var(--boxel-font-size) * 1.375);
      --boxel-font-size-md: calc(var(--boxel-font-size) * 1.25);
      --boxel-font-size-sm: calc(var(--boxel-font-size) * 0.875);
      --boxel-font-size-xs: calc(var(--boxel-font-size) * 0.75);
      --boxel-font-size-2xs: calc(var(--boxel-font-size) * 0.6875);

      /* font-size options based on font-scale */
      --boxel-fs-2xl: calc(var(--boxel-fs-xl) * var(--_boxel-scale)); /* h1 */
      --boxel-fs-xl: calc(var(--boxel-fs-lg) * var(--_boxel-scale)); /* h2 */
      --boxel-fs-lg: calc(var(--boxel-fs-md) * var(--_boxel-scale)); /* h3 */
      --boxel-fs-md: calc(var(--boxel-fs) * var(--_boxel-scale)); /* h4 */
      --boxel-fs: var(--boxel-font-size); /* p */
      --boxel-fs-sm: calc(var(--boxel-fs) / var(--_boxel-scale));
      --boxel-fs-xs: calc(var(--boxel-fs-sm) / var(--_boxel-scale));
      --boxel-fs-2xs: calc(var(--boxel-fs-xs) / var(--_boxel-scale));

      /* spacing */
      --boxel-sp-6xs: calc(var(--boxel-sp-5xs) / var(--_boxel-scale));
      --boxel-sp-5xs: calc(var(--boxel-sp-4xs) / var(--_boxel-scale));
      --boxel-sp-4xs: calc(var(--boxel-sp-3xs) / var(--_boxel-scale));
      --boxel-sp-3xs: calc(var(--boxel-sp-2xs) / var(--_boxel-scale));
      --boxel-sp-2xs: calc(var(--boxel-sp-xs) / var(--_boxel-scale));
      --boxel-sp-xs: calc(var(--boxel-sp-sm) / var(--_boxel-scale));
      --boxel-sp-sm: calc(var(--boxel-sp) / var(--_boxel-scale));
      --boxel-sp: var(--boxel-spacing); /* base */
      --boxel-sp-lg: calc(var(--boxel-sp) * var(--_boxel-scale));
      --boxel-sp-xl: calc(var(--boxel-sp-lg) * var(--_boxel-scale));
      --boxel-sp-2xl: calc(var(--boxel-sp-xl) * var(--_boxel-scale));
      --boxel-sp-3xl: calc(var(--boxel-sp-2xl) * var(--_boxel-scale));
      --boxel-sp-4xl: calc(var(--boxel-sp-3xl) * var(--_boxel-scale));
      --boxel-sp-5xl: calc(var(--boxel-sp-4xl) * var(--_boxel-scale));
      --boxel-sp-6xl: calc(var(--boxel-sp-5xl) * var(--_boxel-scale));

      /* border-radius */
      --boxel-border-radius-xxs: calc(var(--boxel-border-radius-xs) - 2.5px);
      --boxel-border-radius-xs: calc(var(--boxel-border-radius-sm) - 3px);
      --boxel-border-radius-sm: calc(var(--boxel-border-radius) - 3px);
      --boxel-border-radius: var(--boxel-radius); /* base */
      --boxel-border-radius-lg: calc(var(--boxel-border-radius) + 2px);
      --boxel-border-radius-xl: calc(var(--boxel-border-radius-lg) + 3px);
      --boxel-border-radius-xxl: calc(var(--boxel-border-radius-xl) + 5px);
      --boxel-form-control-border-radius: var(--boxel-border-radius);

      /* h1 */
      --boxel-heading-font-family: var(--theme-heading-font-family);
      --boxel-heading-font-size: var(
        --theme-heading-font-size,
        var(--boxel-fs-2xl)
      );
      --boxel-heading-line-height: var(--theme-heading-line-height, 1.1);
      --boxel-heading-font-weight: var(--theme-heading-font-weight, 700);

      /* h2 */
      --boxel-section-heading-font-family: var(
        --theme-section-heading-font-family,
        var(--boxel-heading-font-family)
      );
      --boxel-section-heading-font-size: var(
        --theme-section-heading-font-size,
        var(--boxel-fs-xl)
      );
      --boxel-section-heading-line-height: var(
        --theme-section-heading-line-height,
        var(--boxel-heading-line-height)
      );
      --boxel-section-heading-font-weight: var(
        --theme-section-heading-font-weight,
        var(--boxel-heading-font-weight, 600)
      );

      /* h3 */
      --boxel-subheading-font-family: var(
        --theme-subheading-font-family,
        var(--boxel-heading-font-family)
      );
      --boxel-subheading-font-size: var(
        --theme-subheading-font-size,
        var(--boxel-fs-lg)
      );
      --boxel-subheading-line-height: var(
        --theme-subheading-line-height,
        var(--boxel-heading-line-height)
      );
      --boxel-subheading-font-weight: var(--theme-subheading-font-weight, 600);

      /* base */
      --boxel-body-font-family: var(
        --theme-body-font-family,
        var(--font-sans, var(--boxel-font-family))
      );
      --boxel-body-font-size: var(--theme-body-font-size, var(--boxel-fs));
      --boxel-body-font-weight: var(--theme-body-font-weight, 400);
      --boxel-body-line-height: var(--theme-body-line-height, 1.3);

      /* small text */
      --boxel-caption-font-family: var(--theme-caption-font-family);
      --boxel-caption-font-size: var(
        --theme-caption-font-size,
        var(--boxel-fs-xs)
      );
      --boxel-caption-line-height: var(--theme-caption-line-height);
      --boxel-caption-font-weight: var(--theme-caption-font-weight);

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
      :global(h4, h5, h6) {
        font-size: inherit;
      }
      :global(small) {
        font-family: var(--boxel-caption-font-family);
        font-size: var(--boxel-caption-font-size);
        font-weight: var(--boxel-caption-font-weight);
        line-height: var(--boxel-caption-line-height);
      }
    }
  </style>
</template>;

export default CardContainer;
