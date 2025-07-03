import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { Button, Tooltip } from '@cardstack/boxel-ui/components';
import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';

export interface CopyCodeButtonSignature {
  Args: {
    code?: string | null;
  };
  Element: HTMLButtonElement;
}

export default class CopyCodeButton extends Component<CopyCodeButtonSignature> {
  <template>
    <Tooltip @placement='top'>
      <:trigger>
        <Button
          @kind='text-only'
          class='code-copy-button'
          {{on 'click' (fn (perform this.copyCode) @code)}}
          aria-label={{this.copyCodeButtonText}}
          data-test-copy-code
          ...attributes
        >
          <CopyIcon
            width='16'
            height='16'
            role='presentation'
            aria-hidden='true'
          />
        </Button>
      </:trigger>
      <:content>
        {{this.copyCodeButtonText}}
      </:content>
    </Tooltip>

    <style scoped>
      .code-copy-button {
        --boxel-button-min-width: 1.5rem;
        --boxel-button-min-height: 1.5rem;
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-padding: 4px;
        --boxel-button-text-color: currentColor;
        --icon-color: currentColor;
        border-radius: var(--boxel-border-radius-xs);
        flex-shrink: 0;
      }
    </style>
  </template>

  @tracked private copyCodeButtonText: 'Copy' | 'Copied!' = 'Copy';

  private copyCode = restartableTask(async (code: string) => {
    this.copyCodeButtonText = 'Copied!';
    await navigator.clipboard.writeText(code);
    await timeout(1000);
    this.copyCodeButtonText = 'Copy';
  });
}
