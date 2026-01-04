import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import Info from '@cardstack/boxel-icons/info';

import { Button, IconButton, Tooltip } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Args: {
    isDisplayingCode: boolean;
    toggleViewCode: () => void;
    isCompact?: boolean;
  };
  Element: HTMLButtonElement;
}

const ViewCodeButton: TemplateOnlyComponent<Signature> = <template>
  {{#if @isDisplayingCode}}
    <Button
      class={{cn 'hide-info-button' compact=@isCompact}}
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
    <Tooltip class={{cn 'view-info-tooltip' compact=@isCompact}}>
      <:trigger>
        <IconButton
          class={{cn 'view-info-button' compact=@isCompact}}
          @icon={{Info}}
          @size='base'
          @width={{if @isCompact '16px'}}
          @height={{if @isCompact '16px'}}
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
    .hide-info-button.compact {
      order: 3;
      margin-left: auto;
    }
    .view-info-button.compact {
      --boxel-icon-button-width: 1.5rem;
      --boxel-icon-button-height: 1.5rem;
    }
    .view-info-tooltip.compact {
      order: 3;
      margin-left: auto;
    }
  </style>
</template>;

export default ViewCodeButton;
