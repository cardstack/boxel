import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { element, cn, eq } from '@cardstack/boxel-ui/helpers';

export interface PillSignature {
  Args: {
    kind?: 'button' | 'default';
  };
  Blocks: {
    default: [];
    icon: [];
  };
  Element: HTMLButtonElement | HTMLDivElement;
}

const Pill: TemplateOnlyComponent<PillSignature> = <template>
  {{#let (element (if (eq @kind 'button') 'button' 'div')) as |Tag|}}
    <Tag class={{cn 'pill' button-pill=(eq @kind 'button')}} ...attributes>
      <figure class='icon'>
        {{yield to='icon'}}
      </figure>
      {{yield}}
    </Tag>
  {{/let}}

  <style>
    @layer {
      .pill {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xxxs) var(--boxel-sp-5xs)
          var(--boxel-sp-5xs);
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
        border-radius: var(--boxel-border-radius-sm);
        color: var(--boxel-dark);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .button-pill:not(:disabled):hover,
      .button-pill:not(:disabled):focus {
        background-color: var(--boxel-100);
      }

      .icon {
        display: flex;
        margin-block: 0;
        margin-inline: 0;
      }

      .icon > :deep(*) {
        height: var(--pill-icon-size, 1.25rem);
      }
    }
  </style>
</template>;

export default Pill;
