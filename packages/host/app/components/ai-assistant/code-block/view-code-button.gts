import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import Info from '@cardstack/boxel-icons/info';

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
      @size='small'
      @kind='text-only'
      @rectangular={{true}}
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
          @icon={{Info}}
          @size='base'
          @variant='text-only'
          {{on 'click' @toggleViewCode}}
          aria-label='View Info'
          data-test-view-code-button
          ...attributes
        />
      </:trigger>
      <:content>
        View Info
      </:content>
    </Tooltip>
  {{/if}}
  <style scoped>
    .hide-info-button {
      --boxel-button-padding: 0 var(--boxel-sp-xxxs);
      --boxel-button-min-width: auto;
      --boxel-button-font: 600 var(--boxel-font-xs);
    }
  </style>
</template>;

export default ViewCodeButton;
