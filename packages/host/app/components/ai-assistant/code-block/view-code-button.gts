import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import { Button } from '@cardstack/boxel-ui/components';

interface Signature {
  Args: {
    isDisplayingCode: boolean;
    toggleViewCode: () => void;
  };
  Element: HTMLButtonElement;
}

const ViewCodeButton: TemplateOnlyComponent<Signature> = <template>
  <Button
    class='view-code-button'
    {{on 'click' @toggleViewCode}}
    @kind={{if @isDisplayingCode 'primary-dark' 'secondary-dark'}}
    @size='extra-small'
    data-test-view-code-button
    ...attributes
  >
    {{if @isDisplayingCode 'Hide Code' 'View Code'}}
  </Button>
  <style scoped>
    .view-code-button {
      --boxel-button-font: 600 var(--boxel-font-xs);
      --boxel-button-min-height: 1.5rem;
      --boxel-button-min-width: auto;
      --boxel-button-padding: 0 var(--boxel-sp-xs);
    }
    .view-code-button:not(:disabled):hover {
      filter: brightness(1.1);
    }
  </style>
</template>;

export default ViewCodeButton;
