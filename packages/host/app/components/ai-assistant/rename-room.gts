import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { ModifierLike } from '@glint/template';

import {
  Button,
  FieldContainer,
  BoxelInput,
} from '@cardstack/boxel-ui/components';

import type { RoomField } from 'https://cardstack.com/base/room';

import AiAssistantPanelPopover from '@cardstack/host/components/ai-assistant/panel-popover';

import type MatrixService from '@cardstack/host/services/matrix-service';

interface Signature {
  Args: {
    velcroSettings: ModifierLike<{ Element: HTMLElement }>;
    room: RoomField;
    renameRoom: (name: string) => void;
    cancelRenameRoom: () => void;
    isRunning: boolean;
    roomNameError?: string;
  };
}

export default class RenameRoom extends Component<Signature> {
  <template>
    <AiAssistantPanelPopover {{@velcroSettings}}>
      <:header>
        Rename Session
      </:header>
      <:body>
        <div class='rename-room'>
          <FieldContainer @label='Room Name' @tag='label'>
            <BoxelInput
              {{!-- @state={{this.roomNameInputState}} --}}
              @value={{this.newRoomName}}
              {{!-- @errorMessage={{this.roomNameError}} --}}
              @onInput={{this.setNewRoomName}}
              data-test-room-name-field
            />
          </FieldContainer>
        </div>
        <div class='rename-room-button-wrapper'>
          <Button
            @kind='secondary'
            {{on 'click' this.cancelRoomRename}}
            data-test-cancel-room-name-button
          >
            Cancel
          </Button>
          <Button
            @kind='primary'
            @disabled={{this.isSaveDisabled}}
            {{on 'click' (fn @renameRoom this.newRoomName)}}
            data-test-save-room-name-button
          >
            Save
          </Button>
        </div>
      </:body>
    </AiAssistantPanelPopover>

    <style>
      .rename-room {
        padding: var(--boxel-sp) 0 var(--boxel-sp) var(--boxel-sp);
      }
      .rename-room-button-wrapper {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
      }
    </style>
  </template>

  @service declare matrixService: MatrixService;

  @tracked private newRoomName = this.args.room.name;

  // private get roomNameInputState() {
  //   return this.roomNameError ? 'invalid' : 'initial';
  // }

  private get isSaveDisabled() {
    return (
      this.newRoomName?.length ||
      this.newRoomName === this.args.room.name ||
      this.args.isRunning
    );
  }

  @action
  private setNewRoomName(name: string) {
    this.newRoomName = name;
    // this.roomNameError = undefined;
  }

  @action private cancelRoomRename() {
    this.newRoomName = '';
    // this.roomNameError = undefined;
    this.args.cancelRenameRoom();
  }
}
