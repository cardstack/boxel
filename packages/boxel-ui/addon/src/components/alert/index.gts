import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import type { ComponentLike } from '@glint/template';

import { cn, eq } from '../../helpers.ts';
import { FailureBordered, Warning } from '../../icons.gts';
import Button from '../button/index.gts';

interface MessagesSignature {
  Args: {
    messages: string[];
    type?: 'error' | 'warning';
  };
  Element: HTMLDivElement;
}

interface ActionSignature {
  Args: {
    action?: () => void;
    actionName?: string;
  };
  Element: HTMLDivElement;
}

interface Signature {
  Args: {
    type?: 'error' | 'warning';
  };
  Blocks: {
    default: [
      {
        Action: ComponentLike<ActionSignature>;
        Messages: ComponentLike<MessagesSignature>;
      },
    ];
  };
  Element: HTMLDivElement;
}

const Messages: TemplateOnlyComponent<MessagesSignature> = <template>
  {{#each @messages as |message i|}}
    <div class='alert'>
      {{#if (eq @type 'error')}}
        <FailureBordered class='alert-icon' />
      {{else if (eq @type 'warning')}}
        <Warning class='alert-icon' />
      {{/if}}
      <p
        class='message'
        data-test-alert-message='{{i}}'
        data-test-card-error={{eq @type 'error'}}
      >
        {{message}}
      </p>
    </div>
  {{/each}}
  <style scoped>
    .alert {
      display: flex;
      gap: var(--boxel-sp-xs);
    }
    .alert + .alert {
      margin-top: var(--boxel-sp-lg);
    }
    .alert-icon {
      min-width: 20px;
      height: 20px;
      --icon-background-color: var(--boxel-error-400);
    }
    .message {
      align-self: center;
      overflow: hidden;
      word-wrap: break-word;
      overflow-wrap: break-word;
      margin: 0;
    }
  </style>
</template>;

const Action: TemplateOnlyComponent<ActionSignature> = <template>
  {{#if @action}}
    <Button
      {{on 'click' @action}}
      class='action-button'
      @size='small'
      @kind='primary'
      data-test-alert-action-button={{@actionName}}
    >
      {{@actionName}}
    </Button>
  {{/if}}
  <style scoped>
    .action-button {
      --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
      --boxel-button-min-height: max-content;
      --boxel-button-min-width: max-content;
      border-color: transparent;
      width: fit-content;
      margin-left: auto;
      font-size: var(--boxel-font-size-xs);
      font-weight: 500;
    }
  </style>
</template>;

const Alert: TemplateOnlyComponent<Signature> = <template>
  <div
    class={{cn
      'alert-container'
      error-container=(eq @type 'error')
      warning-container=(eq @type 'warning')
    }}
    data-test-boxel-alert={{@type}}
    ...attributes
  >
    {{yield
      (hash Messages=(component Messages type=@type) Action=(component Action))
    }}
  </div>

  <style scoped>
    .alert-container {
      display: flex;
      flex-direction: column;
      padding: var(--boxel-sp-sm);
      font: 500 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-sm);
      border-radius: var(--boxel-border-radius-xxl);
    }
    .error-container {
      background-color: var(--boxel-650);
      color: var(--boxel-light);
    }
    .warning-container {
      background-color: var(--boxel-warning-200);
      color: var(--boxel-dark);
    }

    .alert-container > :deep(* + *) {
      margin-top: var(--boxel-sp-sm);
    }
  </style>
</template>;

export default Alert;
