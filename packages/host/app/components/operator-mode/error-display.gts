import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import { CopyButton, Button } from '@cardstack/boxel-ui/components';
import {
  DropdownArrowDown,
  DropdownArrowUp,
  Warning,
} from '@cardstack/boxel-ui/icons';

import SwitchSubmodeCommand from '@cardstack/host/commands/switch-submode';
import type CommandService from '@cardstack/host/services/command-service';

import type ErrorDisplayService from '@cardstack/host/services/error-display';
import type { DisplayedErrorProvider } from '@cardstack/host/services/error-display';

import type { FileDef } from 'https://cardstack.com/base/file-api';
import { BoxelErrorForContext } from 'https://cardstack.com/base/matrix-event';

import SendErrorToAIAssistant from './send-error-to-ai-assistant';

interface Signature {
  Element: HTMLElement;
  Args: {
    type: 'syntax' | 'runtime';
    headerText?: string;
    message?: string;
    stack?: string;
    openDetails?: boolean;
    fileToAttach?: FileDef;
    viewInCodeMode?: boolean;
    cardId?: string;
  };
}

export default class ErrorDisplay
  extends Component<Signature>
  implements DisplayedErrorProvider
{
  @tracked private showDetails = this.args.openDetails ?? false;

  @service private declare commandService: CommandService;
  @service private declare errorDisplay: ErrorDisplayService;

  constructor(owner: any, args: any) {
    super(owner, args);
    this.errorDisplay.register(this);
    registerDestructor(this, () => this.errorDisplay.unregister(this));
  }

  private viewInCodeMode = dropTask(async () => {
    let switchSubmodeCommand = new SwitchSubmodeCommand(
      this.commandService.commandContext,
    );
    await switchSubmodeCommand.execute({
      submode: 'code',
      codePath: `${this.args.cardId}.json`,
    });
  });

  private toggleDetails = () => (this.showDetails = !this.showDetails);

  private get errorObject() {
    return {
      message: this.args.message ?? '',
      stack: this.args.stack,
    };
  }

  private get errorText() {
    return JSON.stringify(this.errorObject);
  }

  getError(): BoxelErrorForContext {
    return {
      ...this.errorObject,
      sourceUrl: this.args.fileToAttach?.sourceUrl,
    };
  }

  private get headerText() {
    return this.args.headerText ?? `${this.args.type} Error`;
  }

  <template>
    <div class='error-display' data-test-error-display>
      <div class='error-header'>
        <div class='error-type' data-test-error-type>
          <Warning class='error-icon' />
          <span>{{this.headerText}}</span>
        </div>
        {{#if @fileToAttach}}
          <SendErrorToAIAssistant
            @error={{this.errorObject}}
            @errorType={{@type}}
            @fileToAttach={{@fileToAttach}}
          />
        {{/if}}
      </div>

      {{#if @message}}
        <div class='error-message' data-test-error-message>
          {{@message}}
        </div>
      {{/if}}

      <div class='error-actions'>
        <CopyButton
          @textToCopy={{this.errorText}}
          @width='16px'
          @heigth='16px'
        />
        <Button
          class='toggle-details-button'
          @kind='text-only'
          @size='extra-small'
          {{on 'click' this.toggleDetails}}
          data-test-toggle-details
        >
          {{if this.showDetails 'Hide Details' 'Show Details'}}
          {{#if this.showDetails}}
            <DropdownArrowUp width='12px' height='12px' />
          {{else}}
            <DropdownArrowDown width='12px' height='12px' />
          {{/if}}
        </Button>
      </div>

      {{#if this.showDetails}}
        <div class='error-details' data-test-error-details>
          {{#if @viewInCodeMode}}
            <div class='actions'>
              <Button
                data-test-view-in-code-mode-button
                @kind='primary'
                {{on 'click' (perform this.viewInCodeMode)}}
              >View in Code Mode</Button>
            </div>
          {{/if}}
          <div class='detail-item'>
            <div class='detail-title'>Stack trace:</div>
            {{#if @stack}}
              <pre data-test-error-stack data-test-percy-hide>{{@stack}}</pre>
            {{else}}
              <p class='no-stack-message'>No stack trace is available. This
                could be because the error occurred in a context where stack
                traces are not captured, or the error was handled before a stack
                trace could be generated.</p>
            {{/if}}
          </div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .error-display {
        background: var(--boxel-warning-200);
        border-radius: var(--boxel-border-radius-lg);
        padding-bottom: var(--boxel-sp-xs);
        color: black;
        min-width: fit-content;
        width: 100%;
        box-shadow: var(--boxel-deep-box-shadow);
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        max-height: 100%;
      }

      .error-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--boxel-sp-xs);
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp) var(--boxel-sp) 0 var(--boxel-sp);
      }

      .error-type {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-weight: 600;
        text-transform: uppercase;
      }

      .error-icon {
        width: 20px;
        height: 20px;
        color: black;
      }

      .error-message {
        font-size: var(--boxel-font-size-sm);
        padding: 0 var(--boxel-sp) 0
          calc(var(--boxel-sp) + 20px + var(--boxel-sp-xs));
      }

      .error-actions {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        margin-top: var(--boxel-sp);
        padding: 0 var(--boxel-sp);

        --boxel-icon-button-height: 20px;
        --boxel-icon-button-width: 20px;
      }

      .toggle-details-button {
        padding: 0;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        width: 100px;
        justify-content: flex-end;
        font-weight: 400;
        border: none;
      }

      .toggle-details-button:hover {
        background-color: transparent;
      }

      .error-details {
        background: white;
        padding: var(--boxel-sp);
        width: 100%;
        margin-bottom: calc(-1 * var(--boxel-sp));
        overflow: auto;
        scrollbar-width: thin;
        flex: 1;
      }

      .error-details::-webkit-scrollbar {
        width: 8px;
      }

      .error-details::-webkit-scrollbar-track {
        background: var(--boxel-light);
      }

      .error-details::-webkit-scrollbar-thumb {
        background: var(--boxel-dark);
        border-radius: 4px;
      }

      .detail-item {
        margin-bottom: var(--boxel-sp);
      }

      .detail-item:last-child {
        margin-bottom: 0;
      }

      .detail-title {
        font-weight: 600;
        margin-bottom: var(--boxel-sp-xs);
      }

      .detail-contents {
        word-break: break-word;
      }

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-all;
      }

      .no-stack-message {
        color: var(--boxel-700);
        font-style: italic;
        margin: 0;
      }

      .actions {
        display: flex;
        justify-content: center;
        gap: var(--boxel-sp);
        margin-top: var(--boxel-sp-lg);
      }
    </style>
  </template>
}
