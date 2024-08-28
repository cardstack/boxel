import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { element, cn, eq } from '@cardstack/boxel-ui/helpers';

export type BoxelPillKind = 'button' | 'default';

export interface PillSignature {
  Args: {
    kind?: BoxelPillKind;
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
      {{#if (has-block 'icon')}}
        <figure class='icon'>
          {{yield to='icon'}}
        </figure>
      {{/if}}
      {{yield}}
    </Tag>
  {{/let}}

  <style>
    @layer {
      .pill {
        display: inline-flex;
        align-items: center;
        gap: var(--pill-gap, var(--boxel-sp-5xs));
        padding: var(
          --pill-padding,
          var(--boxel-sp-5xs) var(--boxel-sp-xxxs) var(--boxel-sp-5xs)
            var(--boxel-sp-5xs)
        );
        background-color: var(--pill-background-color, var(--boxel-light));
        color: var(--pill-color, var(--boxel-dark));
        border: 1px solid var(--boxel-400);
        border-radius: var(--boxel-border-radius-sm);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .button-pill:not(:disabled):hover {
        background-color: var(--pill-background-color-hover, var(--boxel-100));
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
