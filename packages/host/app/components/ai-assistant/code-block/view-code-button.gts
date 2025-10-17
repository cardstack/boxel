import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import { Button, IconButton, Tooltip } from '@cardstack/boxel-ui/components';

interface Signature {
  Args: {
    isDisplayingCode: boolean;
    toggleViewCode: () => void;
  };
  Element: HTMLButtonElement;
}

const ViewCodeButton: TemplateOnlyComponent<Signature> = <template>
  {{#if @isDisplayingCode}}
    <Button
      class='hide-info-button'
      {{on 'click' @toggleViewCode}}
      @kind='text-only'
      @size='small'
      data-test-view-code-button
      ...attributes
    >
      Hide Info
    </Button>
  {{else}}
    <Tooltip>
      <:trigger>
        <IconButton
          class='view-info-button'
          @size='medium'
          @kind='secondary-dark'
          @round={{true}}
          {{on 'click' @toggleViewCode}}
          aria-label='View Info'
          data-test-view-code-button
          ...attributes
        >
          i
        </IconButton>
      </:trigger>
      <:content>
        View Info
      </:content>
    </Tooltip>
  {{/if}}
  <style scoped>
    .view-info-button {
      --boxel-icon-med: 1.5rem;
    }
    .hide-info-button {
      --boxel-button-padding: 0 var(--boxel-sp-xxxs);
      --boxel-button-min-width: auto;
      border-radius: var(--boxel-border-radius-sm);
    }
  </style>
</template>;

export default ViewCodeButton;
