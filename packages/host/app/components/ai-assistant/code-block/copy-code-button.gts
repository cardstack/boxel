import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { Button } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';

export interface CopyCodeButtonSignature {
  Args: {
    code?: string | null;
  };
}

export default class CopyCodeButton extends Component<CopyCodeButtonSignature> {
  <template>
    <Button
      @kind='text-only'
      class='code-copy-button'
      {{on 'click' (fn (perform this.copyCode) @code)}}
      aria-label={{this.copyCodeButtonText}}
      data-test-copy-code
    >
      <span class={{cn 'copy-text' shown=this.copyCode.isRunning}}>
        {{this.copyCodeButtonText}}
      </span>
      <CopyIcon
        width='16'
        height='16'
        role='presentation'
        aria-hidden='true'
        class='copy-icon'
      />
    </Button>

    <style scoped>
      .code-copy-button {
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-text-color: var(--boxel-light);
        --boxel-button-padding: 4px;
        --boxel-button-min-width: 1.5rem;
        --boxel-button-min-height: 1.5rem;
        --icon-color: currentColor;
        border-radius: var(--boxel-border-radius-xs);
      }
      .code-copy-button:not(:disabled):hover > .copy-text + .copy-icon,
      .copy-text.shown + .copy-icon {
        margin-left: var(--boxel-sp-xxs);
      }
      .copy-text {
        display: none;
      }
      .code-copy-button:not(:disabled):hover {
        min-width: 78px;
      }
      .code-copy-button:not(:disabled):hover > .copy-text,
      .copy-text.shown {
        display: block;
      }
      .copy-icon {
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
