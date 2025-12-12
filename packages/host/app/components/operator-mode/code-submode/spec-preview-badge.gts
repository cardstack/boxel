import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import Check from '@cardstack/boxel-icons/check';

import { BoxelButton } from '@cardstack/boxel-ui/components';
import { IconPlus } from '@cardstack/boxel-ui/icons';

import type { Spec } from 'https://cardstack.com/base/spec';

interface SpecPreviewBadgeSignature {
  Args: {
    spec?: Spec;
    numberOfInstances?: number;
    showCreateSpec: boolean;
    createSpec: (event: MouseEvent) => void;
    isCreateSpecInstanceRunning: boolean;
  };
}

const SpecPreviewBadge: TemplateOnlyComponent<SpecPreviewBadgeSignature> =
  <template>
    <span class='spec-indicator'>
      {{#if @showCreateSpec}}
        <BoxelButton
          class='create-spec-button'
          @icon='plus'
          @kind='primary'
          @size='extra-small'
          @loading={{@isCreateSpecInstanceRunning}}
          {{on 'click' @createSpec}}
          data-test-create-spec-button
        >
          {{#unless @isCreateSpecInstanceRunning}}
            <IconPlus width='10px' height='10px' />
          {{/unless}}
        </BoxelButton>
      {{else if @spec}}
        <Check class='spec-checkmark' data-test-spec-exists />
      {{/if}}
    </span>

    <style scoped>
      .spec-indicator {
        display: flex;
      }

      .create-spec-button {
        --boxel-button-min-height: auto;
        --boxel-button-min-width: auto;
        padding: 4px;
        border: none;
        border-radius: var(--boxel-border-radius-xs);
      }

      .create-spec-button :deep(.boxel-loading-indicator) {
        --loading-indicator-size: 12px;
        margin-right: 0;
      }

      .boxel-button:not(.active) .spec-checkmark {
        color: var(--boxel-400);
      }

      .spec-checkmark {
        stroke: currentColor;
        width: var(--boxel-sp);
      }
    </style>
  </template>;

export default SpecPreviewBadge;
