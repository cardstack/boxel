import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Button } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

import type { ComponentLike } from '@glint/template';

interface ToggleButtonSignature {
  Args: {
    icon: ComponentLike;
    disabled?: boolean;
    isActive: boolean;
  };
  Element: typeof Button.Element;
  Blocks: {
    default: [];
    annotation: [];
  };
}

const ToggleButton: TemplateOnlyComponent<ToggleButtonSignature> = <template>
  <Button
    @disabled={{@disabled}}
    @kind={{if @isActive 'primary-dark' 'secondary'}}
    @size='extra-small'
    class={{cn 'toggle-button' active=@isActive}}
    ...attributes
  >

    <span class='content'>
      {{#if @icon}}
        <figure
          class='icon'
          aria-hidden='true'
        >{{@icon}}</figure>{{/if}}{{yield}}</span>

    {{#if (has-block 'annotation')}}
      <span class='annotation'>{{yield to='annotation'}}</span>
    {{/if}}
  </Button>
  <style scoped>
    .toggle-button {
      --boxel-button-border: 1px solid var(--boxel-400);
      --boxel-button-font: 600 var(--boxel-font-xs);
      --boxel-button-letter-spacing: var(--boxel-lsp-xs);
      --boxel-button-min-width: 4rem;
      --boxel-button-padding: 0;
      --boxel-button-color: var(--boxel-light);
      border-radius: var(--boxel-border-radius);
      flex: 1;
      justify-content: space-between;
    }
    .toggle-button:hover:not(:disabled) {
      border-color: var(--boxel-dark);
    }
    .toggle-button.active {
      border-color: var(--boxel-dark);
      --boxel-button-color: var(--boxel-dark);
      --boxel-button-text-color: var(--boxel-highlight);
    }

    .content {
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-xs);
      margin: -2px 0;
    }

    .icon {
      transform: scale(0.75);
      margin: 2px -6px 0 4px;
    }
  </style>
</template>;

export default ToggleButton;
