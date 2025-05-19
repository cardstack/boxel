import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';

import Component from '@glimmer/component';

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

  <template>
    <div class='error-detail' ...attributes>
      <ErrorDisplay
        @type='runtime'
        @message={{@error.message}}
        @title={{if @title @title @error.title}}
        @stack={{@error.meta.stack}}
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
        overflow: auto;
        margin-top: auto;
        max-height: fit-content;
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
