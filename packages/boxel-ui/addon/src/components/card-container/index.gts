import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import element from '../../helpers/element.ts';
import { sanitizeHtml } from '../../helpers/sanitize-html.ts';

interface Signature {
  Args: {
    cssImports?: string[];
    displayBoundaries?: boolean;
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
      font-family: var(--font-sans, var(--boxel-font-family));
      transition:
        max-width var(--boxel-transition),
        box-shadow var(--boxel-transition);
      height: 100%;
      width: 100%;
      overflow: hidden;
      box-shadow: var(--shadow);
    }
    :global(.boxel-card-container--boundaries) {
      box-shadow:
        0 0 0 1px var(--border, var(--boxel-border-color)),
        var(--shadow, 0 0 0 1px var(--boxel-border-color));
    }
    :global(.boxel-card-container--boundaries.hide-boundaries) {
      box-shadow: none;
    }
    :global(.boxel-card-container .boxel-card-container) {
      background-color: var(--card, var(--boxel-light));
      border-radius: var(--radius, var(--boxel-border-radius));
      color: var(--card-foreground, var(--boxel-dark));
    }
  </style>
</template>;

export default CardContainer;
