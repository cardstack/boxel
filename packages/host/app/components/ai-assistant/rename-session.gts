import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import onKeyMod from 'ember-keyboard/modifiers/on-key';

import { BoxelInput, Button } from '@cardstack/boxel-ui/components';

import { isMatrixError } from '@cardstack/host/lib/matrix-utils';
import type { SessionRoomData } from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

import AiAssistantPanelPopover from './panel-popover';

interface Signature {
  Element: HTMLElement;
  Args: {
    room: SessionRoomData;
    onClose: () => void;
  };
}

export default class RenameSession extends Component<Signature> {
  <template>
    <AiAssistantPanelPopover
      @onClose={{@onClose}}
      class='rename-session'
      data-test-rename-session
      ...attributes
    >
      <:header>Rename Session</:header>
      <:body>
        <div class='rename-field'>
          <BoxelInput
            @state={{this.roomNameInputState}}
            @value={{this.newRoomName}}
            @errorMessage={{this.roomNameError}}
            @onInput={{this.setName}}
            aria-label='Session Name'
            data-test-name-field
          />
        </div>
        <footer class='footer'>
          <Button
            @kind='secondary'
            @size='extra-small'
            {{on 'click' @onClose}}
            {{onKeyMod 'Escape' @onClose}}
            data-test-cancel-name-button
          >
            Cancel
          </Button>
          <Button
            @kind='primary'
            @size='extra-small'
            @disabled={{this.isSaveRenameDisabled}}
            @loading={{this.doRenameRoom.isRunning}}
            {{on 'click' this.renameRoom}}
            {{onKeyMod 'Enter' this.renameRoom}}
            data-test-save-name-button
          >
            Save
          </Button>
        </footer>
      </:body>
    </AiAssistantPanelPopover>

    <style scoped>
      .rename-session {
        --boxel-button-color: var(--boxel-light);

        min-height: unset;
      }

      .rename-field {
        padding: 0 var(--boxel-sp-xs);
      }
      .rename-field :deep(.label) {
        font: 600 var(--boxel-font-sm);
      }
      .footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
      }
      .footer :deep(.boxel-button:not(:disabled)) {
        --boxel-button-text-color: var(--boxel-dark);
      }
    </style>
  </template>

  @service declare private matrixService: MatrixService;
  @tracked private newRoomName = this.args.room.name;
  @tracked private roomNameError: string | undefined = undefined;

  private get roomNameInputState() {
    return this.roomNameError ? 'invalid' : 'initial';
  }

  private get isSaveRenameDisabled() {
    return (
      !this.newRoomName?.length ||
      this.newRoomName === this.args.room.name ||
      this.doRenameRoom.isRunning
    );
  }

  @action
  private setName(name: string) {
    this.roomNameError = undefined;
    this.newRoomName = name;
  }

  @action private renameRoom() {
    this.doRenameRoom.perform();
  }

  private doRenameRoom = restartableTask(async () => {
    if (!this.newRoomName?.length || !this.args.room.roomId) {
      throw new Error(`bug: should never get here`);
    }
    try {
      await this.matrixService.setRoomName(
        this.args.room.roomId,
        this.newRoomName,
      );
      this.roomNameError = undefined;
      this.newRoomName = '';
      this.args.onClose();
    } catch (e) {
      console.error(e);
      this.roomNameError = `Error renaming room`;
      if (isMatrixError(e)) {
        this.roomNameError += `: ${e.data.error}`;
      } else if (e instanceof Error) {
        this.roomNameError += `: ${e.message}`;
      }
    }
  });
}
