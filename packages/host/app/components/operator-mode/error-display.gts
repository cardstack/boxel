import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { CopyButton } from '@cardstack/boxel-ui/components';
import { ExclamationTriangleFill } from '@cardstack/boxel-ui/icons';
import { DropdownArrowDown, DropdownArrowUp } from '@cardstack/boxel-ui/icons';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import SendErrorToAIAssistant from './send-error-to-ai-assistant';

interface Signature {
  Element: HTMLElement;
  Args: {
    type: 'syntax' | 'runtime';
    message: string;
    title?: string;
    stack?: string;
    fileToAttach?: FileDef;
  };
}

export default class ErrorDisplay extends Component<Signature> {
  @tracked private showDetails = false;

  private toggleDetails = () => (this.showDetails = !this.showDetails);

  private get errorObject() {
    return {
      message: this.args.message,
      stack: this.args.stack,
      title: this.args.title,
    };
  }

  <template>
    <div class='error-display' data-test-error-display>
      <div class='error-header'>
        <div class='error-type'>
          <ExclamationTriangleFill class='error-icon' />
          <span>{{@type}} Error</span>
        </div>
        {{#if @fileToAttach}}
          <SendErrorToAIAssistant
            @error={{this.errorObject}}
            @errorType={{@type}}
            @fileToAttach={{@fileToAttach}}
          />
        {{/if}}
      </div>

      {{#if @title}}
        <div class='error-title' data-test-error-title>
          {{@title}}
        </div>
      {{/if}}

      <div class='error-actions'>
        <CopyButton @textToCopy={{@message}} @width='16px' @heigth='16px' />
        <button
          class='toggle-details-button'
          {{on 'click' this.toggleDetails}}
          data-test-toggle-details
        >
          {{if this.showDetails 'Hide Details' 'Show Details'}}
          {{#if this.showDetails}}
            <DropdownArrowUp width='12px' height='12px' />
          {{else}}
            <DropdownArrowDown width='12px' height='12px' />
          {{/if}}
        </button>
      </div>

      {{#if this.showDetails}}
        <div class='error-details'>
          <div class='detail-item'>
            <div class='detail-title'>Message:</div>
            <div class='detail-contents' data-test-error-message>
              {{@message}}
            </div>
          </div>
          {{#if @stack}}
            <div class='detail-item'>
              <div class='detail-title'>Stack trace:</div>
              <pre data-test-error-stack>{{@stack}}</pre>
            </div>
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .error-display {
        background: #ffba00;
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp);
        color: black;
        min-width: fit-content;
      }

      .error-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--boxel-sp-xs);
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
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

      .error-title {
        font-weight: 500;
      }

      .error-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--boxel-sp);

        margin-bottom: calc(-1 * var(--boxel-sp-xs));

        --boxel-icon-button-width: 20px;
        --boxel-icon-button-width: 20px;
      }

      .toggle-details-button {
        background: none;
        border: none;
        cursor: pointer;
        font: 500 var(--boxel-font-xs);
        color: black;
        padding: 0;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        width: 100px;
        justify-content: flex-end;
      }

      .error-details {
        background: rgba(0, 0, 0, 0.1);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
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
        white-space: pre-wrap;
        word-break: break-word;
      }

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-all;
      }
    </style>
  </template>
}
