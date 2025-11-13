import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import type { ComponentLike } from '@glint/template';

import { cn, eq } from '../../helpers.ts';
import { FailureBordered, Warning } from '../../icons.gts';
import Button, { type BoxelButtonKind } from '../button/index.gts';

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
    kind?: BoxelButtonKind;
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
        <FailureBordered class='alert-icon failure-icon' />
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
      --icon-background-color: var(--boxel-danger);
    }
    .failure-icon {
      --icon-background-color: var(--destructive, var(--boxel-danger));
      --icon-color: var(--destructive-foreground, var(--boxel-light));
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
      @size='extra-small'
      @kind={{@kind}}
      data-test-alert-action-button={{@actionName}}
    >
      {{@actionName}}
    </Button>
  {{/if}}
  <style scoped>
    .action-button {
      --boxel-button-min-width: max-content;
      width: fit-content;
      margin-left: auto;
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
      (hash
        Messages=(component Messages type=@type)
        Action=(component
          Action kind=(if (eq @type 'warning') 'primary-dark' 'primary')
        )
      )
    }}
  </div>

  <style scoped>
    .alert-container {
      display: flex;
      flex-direction: column;
      padding: var(--boxel-sp-sm);
      font: 500 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-sm);
      border-radius: var(--boxel-border-radius-2xl);
    }
    .error-container {
      background-color: var(--destructive-foreground, var(--boxel-650));
      color: var(--destructive, var(--boxel-light));
    }
    .warning-container {
      background-color: var(--accent, var(--boxel-warning-200));
      color: var(--accent-foreground, var(--boxel-dark));
    }

    .alert-container > :deep(* + *) {
      margin-top: var(--boxel-sp-sm);
    }
  </style>
</template>;

export default Alert;
