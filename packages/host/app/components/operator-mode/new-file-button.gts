import Component from '@glimmer/component';
import { array } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { DropdownButton } from '@cardstack/boxel-ui/components';
import { menuItem } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';
import CreateFileModal from './create-file-modal';

interface Signature {
  Args: {
    realmURL: URL;
  };
}

export default class NewFileButton extends Component<Signature> {
  <template>
    <DropdownButton
      class='new-file-button'
      @kind='primary'
      @size='small'
      @items={{array (menuItem 'Card Instance' this.toggleNewFileModal)}}
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

    {{#if this.newFileModalShown}}
      <CreateFileModal
        @realmURL={{@realmURL}}
        @onClose={{this.toggleNewFileModal}}
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

  @tracked newFileModalShown = false;

  @action toggleNewFileModal() {
    this.newFileModalShown = !this.newFileModalShown;
  }
}
