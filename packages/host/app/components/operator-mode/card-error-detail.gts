import { on } from '@ember/modifier';
import { service } from '@ember/service';

import Component from '@glimmer/component';

import { dropTask } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import { Button } from '@cardstack/boxel-ui/components';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import SwitchSubmodeCommand from '../../commands/switch-submode';
import { type CardErrorJSONAPI } from '../../services/store';

import ErrorDisplay from './error-display';

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
  @service private declare commandService: CommandService;

  private viewInCodeMode = dropTask(async () => {
    let switchSubmodeCommand = new SwitchSubmodeCommand(
      this.commandService.commandContext,
    );
    await switchSubmodeCommand.execute({
      submode: 'code',
      codePath: `${this.args.error.id}.json`,
    });
  });

  private get message() {
    return this.args.error.message ?? undefined;
  }

  private get stack() {
    return this.args.error.meta.stack ?? undefined;
  }

  <template>
    <div class='error-detail' ...attributes>
      <ErrorDisplay
        @type='runtime'
        @headerText={{@headerText}}
        @message={{if this.message this.message @error.title}}
        @stack={{this.stack}}
        @fileToAttach={{@fileToFixWithAi}}
      />

      {{#if @viewInCodeMode}}
        <div class='actions'>
          <Button
            data-test-view-in-code-mode-button
            @kind='primary'
            {{on 'click' (perform this.viewInCodeMode)}}
          >View in Code Mode</Button>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .error-detail {
        flex: 1.5;
        overflow: visible;
        margin-top: auto;
        max-height: fit-content;
        margin: var(--boxel-sp);
      }
      @media (min-height: 800px) {
        .error-detail {
          flex: 1;
        }
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
