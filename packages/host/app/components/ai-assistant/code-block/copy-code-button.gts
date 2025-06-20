import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { cn } from '@cardstack/boxel-ui/helpers';
import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';

export interface CopyCodeButtonSignature {
  Args: {
    code?: string | null;
  };
}

export default class CopyCodeButton extends Component<CopyCodeButtonSignature> {
  @tracked copyCodeButtonText: 'Copy' | 'Copied!' = 'Copy';

  copyCode = restartableTask(async (code: string) => {
    this.copyCodeButtonText = 'Copied!';
    await navigator.clipboard.writeText(code);
    await timeout(1000);
    this.copyCodeButtonText = 'Copy';
  });

  <template>
    <button
      class='code-copy-button'
      {{on 'click' (fn (perform this.copyCode) @code)}}
      data-test-copy-code
    >
      <CopyIcon
        width='16'
        height='16'
        role='presentation'
        aria-hidden='true'
        class='copy-icon'
      />
      <span class={{cn 'copy-text' shown=this.copyCode.isRunning}}>
        {{this.copyCodeButtonText}}
      </span>
    </button>
    <style scoped>
      .code-copy-button {
        color: var(--boxel-highlight);
        background: none;
        border: none;
        font: 600 var(--boxel-font-xs);
        padding: 0;
        display: flex;
        align-items: center;
        width: auto;
      }

      .code-copy-button svg {
        margin-right: var(--boxel-sp-xs);
      }

      .copy-icon {
        --icon-color: var(--boxel-highlight);
      }

      .copy-text {
        display: none;
      }

      .code-copy-button:hover .copy-text {
        display: block;
      }

      .code-copy-button .copy-text.shown {
        display: block;
      }
    </style>
  </template>
}
