import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import InfoIcon from '@cardstack/boxel-icons/info';

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
    @kind='text-only'
    @size='extra-small'
    aria-label={{if @isDisplayingCode 'Hide Code' 'View Code'}}
    data-test-view-code-button
    ...attributes
  >
    {{#if @isDisplayingCode}}
      <span>Hide Info</span>
    {{else}}
      <InfoIcon width='18' height='18' role='presentation' />
    {{/if}}
  </Button>
  <style scoped>
    .view-code-button {
      --boxel-button-font: 600 var(--boxel-font-xs);
      --boxel-button-min-height: 1.5rem;
      --boxel-button-min-width: auto;
      --boxel-button-padding: 0 var(--boxel-sp-xxxs);
      --boxel-button-text-color: var(--boxel-light);
      gap: var(--boxel-sp-xxs);
      border-radius: var(--boxel-border-radius-xs);
    }
  </style>
</template>;

export default ViewCodeButton;
