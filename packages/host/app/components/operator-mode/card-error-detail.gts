import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { Accordion, Button } from '@cardstack/boxel-ui/components';
import { ExclamationCircle } from '@cardstack/boxel-ui/icons';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import SwitchSubmodeCommand from '../../commands/switch-submode';
import { type CardErrorJSONAPI } from '../../services/store';

import FixItButton from './fix-it-button';

import type CommandService from '../../services/command-service';

interface Signature {
  Args: {
    error: CardErrorJSONAPI;
    viewInCodeMode?: boolean;
    title?: string;
    headerText?: string;
    fileToFixWithAi?: FileDef;
  };
  Element: HTMLElement;
}

export default class CardErrorDetail extends Component<Signature> {
  @tracked private showErrorDetail = false;
  @service private declare commandService: CommandService;

  private toggleDetail = () => (this.showErrorDetail = !this.showErrorDetail);

  private viewInCodeMode = dropTask(async () => {
    let switchSubmodeCommand = new SwitchSubmodeCommand(
      this.commandService.commandContext,
    );
    await switchSubmodeCommand.execute({
      submode: 'code',
      codePath: `${this.args.error.id}.json`,
    });
  });

  private get errorObject() {
    return {
      message: this.args.error.message,
      stack: this.args.error.meta.stack ?? undefined,
      title: this.args.error.title,
    };
  }

  <template>
    <Accordion
      class='error-detail {{if this.showErrorDetail "open"}}'
      ...attributes
      as |A|
    >
      <A.Item
        data-test-error-detail-toggle
        @onClick={{fn this.toggleDetail 'schema'}}
        @isOpen={{this.showErrorDetail}}
      >
        <:title>
          <div class='title'>
            <ExclamationCircle class='error-icon' />
            {{unless @headerText  'An error was encountered: '}}
            <span data-test-error-title>
              {{if @title @title @error.title}}
            </span>
            {{#if @fileToFixWithAi}}
              <FixItButton
                @error={{this.errorObject}}
                @errorType='card'
                @fileToAttach={{@fileToFixWithAi}}
              />
            {{/if}}
          </div>
        </:title>
        <:content>
          <div class='actions'>
            {{#if @viewInCodeMode}}
              <Button
                data-test-view-in-code-mode-button
                @kind='primary'
                {{on 'click' (perform this.viewInCodeMode)}}
              >View in Code Mode</Button>
            {{/if}}
          </div>
          <div class='detail'>
            <div class='detail-item'>
              <div class='detail-title'>Details:</div>
              <div
                class='detail-contents'
                data-test-error-detail
              >{{@error.message}}</div>
            </div>
            {{#if @error.meta.stack}}
              <div class='detail-item'>
                <div class='detail-title'>Stack trace:</div>
                <pre
                  data-test-error-stack
                  data-test-percy-hide
                >
{{@error.meta.stack}}
                </pre>
              </div>
            {{/if}}
          </div>
        </:content>
      </A.Item>
    </Accordion>

    <style scoped>
      .title {
        display: flex;
        align-items: center;
        width: 100%;
        gap: var(--boxel-sp-xs);
      }
      .title :deep(.fix-it-button) {
        margin-left: auto;
      }
      .error-detail {
        flex: 1.5;
        overflow: auto;
        margin-top: auto;
        max-height: fit-content;
      }
      .error-detail :deep(.accordion-item) {
        height: auto;
      }
      @media (min-height: 800px) {
        .error-detail {
          flex: 1;
        }
      }
      .error-detail.open {
        max-height: unset;
      }
      .error-detail :deep(.title) {
        font: 600 var(--boxel-font-sm);
        background-color: #ffe3e3;
      }
      .error-icon {
        color: var(--boxel-error-300);
      }
      .actions {
        display: flex;
        justify-content: center;
        gap: var(--boxel-sp);
        margin-top: var(--boxel-sp-lg);
      }
      .detail {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
      }
      .detail-title {
        font: 600 var(--boxel-font-sm);
      }
      .detail-contents {
        font: var(--boxel-font-sm);
      }
      pre {
        margin-top: 0;
        white-space: pre-wrap;
        word-break: break-all;
      }
    </style>
  </template>
}
