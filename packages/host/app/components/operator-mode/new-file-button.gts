import Component from '@glimmer/component';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { capitalize } from '@ember/string';
import { tracked } from '@glimmer/tracking';
import { DropdownButton } from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';
import CreateFileModal, {
  type NewFileType,
  newFileTypes,
} from './create-file-modal';

interface Signature {
  Args: {
    realmURL: URL;
    onSave: (fileURL: URL) => void;
  };
}

export default class NewFileButton extends Component<Signature> {
  <template>
    <DropdownButton
      class='new-file-button'
      @kind='primary'
      @size='small'
      @items={{this.menuItems}}
      @disabled={{this.newFileType}}
      data-test-new-file-button
    >
      <IconPlus
        @width='var(--boxel-icon-sm)'
        @height='var(--boxel-icon-sm)'
        stroke='var(--boxel-light)'
        stroke-width='1px'
        aria-label='Add'
        class='new-file-button-icon'
      />
      New File
    </DropdownButton>

    {{#if this.newFileType}}
      <CreateFileModal
        @fileType={{this.newFileType}}
        @realmURL={{@realmURL}}
        @onSave={{@onSave}}
        @onClose={{fn this.setNewFileType undefined}}
      />
    {{/if}}

    <style>
      .new-file-button {
        --new-file-button-width: 7.5rem;
        --new-file-button-height: var(--boxel-form-control-height);
        --boxel-button-text-color: var(--boxel-light);

        height: var(--new-file-button-height);
        width: var(--new-file-button-width);
        margin-left: var(--boxel-sp);
      }
      .new-file-button-icon {
        --icon-color: var(--boxel-light);
        flex-shrink: 0;
        margin-right: var(--boxel-sp-5xs);
      }
    </style>
  </template>

  @tracked newFileType?: { id: NewFileType; displayName: string } = undefined;

  @action setNewFileType(
    type: { id: NewFileType; displayName: string } | undefined,
  ) {
    this.newFileType = type;
  }

  get menuItems() {
    return newFileTypes.map((id) => {
      let displayName = id
        .split('-')
        .map((el) => capitalize(el))
        .join(' ');
      return new MenuItem(displayName, 'action', {
        action: () => this.setNewFileType({ id, displayName }),
      });
    });
  }
}
