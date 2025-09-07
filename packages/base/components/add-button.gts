import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Button, Pill } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

interface Signature {
  Args: {
    variant?: 'pill' | 'full-width';
    hideIcon?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

const AddButton: TemplateOnlyComponent<Signature> = <template>
  {{#if (eq @variant 'pill')}}
    <Pill
      class='base-add-button add-button--pill'
      @kind='button'
      @variant='primary'
      ...attributes
    >
      <:iconLeft>
        <IconPlus class='icon' width='12px' height='12px' alt='plus' />
      </:iconLeft>
      <:default>
        {{yield}}
      </:default>
    </Pill>
  {{else}}
    <Button
      class='base-add-button add-button--full-width'
      @kind='muted'
      ...attributes
    >
      {{#unless @hideIcon}}
        <IconPlus class='icon' width='12px' height='12px' alt='plus' />
      {{/unless}}
      {{yield}}
    </Button>
  {{/if}}
  <style scoped>
    @layer baseAddButton {
      .base-add-button {
        --_ab-gap: var(--add-button-gap, var(--boxel-sp-xxxs));
        --_ab-padding: var(
          --add-button-padding,
          var(--boxel-sp-5xs) var(--boxel-sp-sm)
        );
        --icon-color: var(--add-button-icon-color, currentColor);
      }
      .base-add-button:not(:disabled):hover {
        filter: brightness(0.95);
      }
      .icon {
        color: var(--icon-color);
      }

      .add-button--pill {
        --pill-gap: var(--_ab-gap);
        --pill-padding: var(--_ab-padding);
        --pill-font: var(--add-button-pill-font, 600 var(--boxel-font-xs));
      }

      .add-button--full-width {
        --boxel-button-border-radius: var(--boxel-form-control-border-radius);
        --boxel-button-padding: var(--_ab-padding);
        --boxel-button-min-height: 3.75rem;
        --boxel-button-letter-spacing: var(--boxel-lsp-xs);
        width: 100%;
        max-width: 100%;
        display: flex;
        justify-content: center;
        gap: var(--_ab-gap);
        box-shadow: var(--shadow);
      }
    }
  </style>
</template>;

export default AddButton;
