import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import type { RoomField } from 'https://cardstack.com/base/room';

import {
  Button,
  BoxelInput,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

interface Signature {
  Args: {
    room: RoomField;
    onSave: (name: string) => void;
    onCancel: () => void;
    roomNameError?: string;
  };
}

export default class RoomNameEditor extends Component<Signature> {
  <template>
    <section class='room-name-editor'>
      <header>
        <h3>Rename Room</h3>
      </header>
      <FieldContainer
        @label='Session Name'
        @tag='label'
        @isVertical={{true}}
        @placeholder='Type name'
        class='create-room__field'
      >
        <BoxelInput
          data-test-room-name-field
          @id=''
          @state={{this.roomNameInputState}}
          @value={{this.newRoomName}}
          @errorMessage={{@roomNameError}}
          @onInput={{this.setNewRoomName}}
        />
        {{log this.name}}
      </FieldContainer>
      <footer class='create-button-wrapper'>
        <Button
          @kind='secondary'
          data-test-create-room-cancel-btn
          class='room__button'
          {{on 'click' @onCancel}}
        >
          Cancel
        </Button>
        <Button
          data-test-create-room-btn
          class='room__button'
          @kind='primary'
          @disabled={{this.isSaveDisabled}}
          {{on 'click' this.saveRoomName}}
        >
          Save
        </Button>
      </footer>
    </section>
    <style>
      .room-name-editor {
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
      }
    </style>
  </template>

  @tracked private newRoomName: string | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    this.newRoomName = args.room.name;
  }

  private get roomNameInputState() {
    return this.args.roomNameError ? 'invalid' : 'initial';
  }

  private get isSaveDisabled() {
    return (
      !this.newRoomName ||
      this.newRoomName.trim() === '' ||
      this.args.roomNameError ||
      this.newRoomName === this.args.room.name
    );
  }

  get name() {
    return this.newRoomName;
  }

  @action
  private setNewRoomName(name: string) {
    // TODO: Validate name
    this.newRoomName = name;
  }

  @action
  private saveRoomName() {
    if (this.args.roomNameError) {
      throw new Error('Cannot save invalid room name');
    }
    if (!this.newRoomName || this.isSaveDisabled) {
      this.args.onCancel();
      return;
    }
    this.args.onSave(this.newRoomName);
  }
}
