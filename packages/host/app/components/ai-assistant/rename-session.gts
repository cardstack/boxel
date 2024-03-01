import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  FieldContainer,
  BoxelInput,
  Button,
} from '@cardstack/boxel-ui/components';

import { isMatrixError } from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

import type { RoomField } from 'https://cardstack.com/base/room';

import AiAssistantPanelPopover from './panel-popover';

interface Signature {
  Element: HTMLElement;
  Args: {
    room: RoomField;
    onClose: () => void;
  };
}

export default class RenameSession extends Component<Signature> {
  <template>
    <AiAssistantPanelPopover
      @onClose={{@onClose}}
      data-test-rename-session
      ...attributes
    >
      <:header>Rename Session</:header>
      <:body>
        <div class='rename-field'>
          <FieldContainer @label='Session Name' @tag='label' @vertical={{true}}>
            <BoxelInput
              @state={{this.roomNameInputState}}
              @value={{this.newRoomName}}
              @errorMessage={{this.roomNameError}}
              @onInput={{this.setName}}
              data-test-name-field
            />
          </FieldContainer>
        </div>
        <footer class='footer'>
          <Button
            @kind='secondary'
            @size='small'
            {{on 'click' @onClose}}
            {{onKeyMod 'Escape' @onClose}}
            data-test-cancel-name-button
          >
            Cancel
          </Button>
          <Button
            @kind='primary'
            @size='small'
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

    <style>
      .rename-field {
        padding: 0 var(--boxel-sp);
      }
      .rename-field :deep(.label) {
        font: 700 var(--boxel-font-sm);
      }
      .footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
      }
      .footer :deep(.boxel-button:not(:disabled)) {
        --boxel-button-text-color: var(--boxel-dark);
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;
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
    if (!this.newRoomName.length || !this.args.room.roomId) {
      throw new Error(`bug: should never get here`);
    }
    try {
      await this.matrixService.client.setRoomName(
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
