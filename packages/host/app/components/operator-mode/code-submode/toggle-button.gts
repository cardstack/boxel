import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Button } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

interface ToggleButtonSignature {
  Args: {
    disabled?: boolean;
    isActive: boolean;
  };
  Element: typeof Button.Element;
  Blocks: typeof Button.Blocks;
}

const ToggleButton: TemplateOnlyComponent<ToggleButtonSignature> = <template>
  <Button
    @disabled={{@disabled}}
    @kind={{if @isActive 'primary-dark' 'secondary'}}
    @size='extra-small'
    class={{cn 'toggle-button' active=@isActive}}
    ...attributes
  >
    {{yield}}
  </Button>
  <style scoped>
    .toggle-button {
      --boxel-button-border: 1px solid var(--boxel-400);
      --boxel-button-font: 600 var(--boxel-font-xs);
      --boxel-button-letter-spacing: var(--boxel-lsp-xs);
      --boxel-button-min-width: 4rem;
      --boxel-button-padding: 0;
      border-radius: var(--boxel-border-radius);
      flex: 1;
    }
    .toggle-button:hover:not(:disabled) {
      border-color: var(--boxel-dark);
    }
    .toggle-button.active {
      border-color: var(--boxel-dark);
      --boxel-button-text-color: var(--boxel-highlight);
    }
  </style>
</template>;

export default ToggleButton;
