import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { FieldContainer, Button } from '@cardstack/boxel-ui/components';

import ModalContainer from '../modal-container';
import RealmDropdown, { type RealmDropdownItem } from '../realm-dropdown';

interface Signature {
  Args: {
    onClose: () => void;
    realmURL?: URL;
  };
}

export default class CreateFileModal extends Component<Signature> {
  <template>
    <ModalContainer
      class='create-file-modal'
      @cardContainerClass='create-file'
      @title='New File'
      @size='medium'
      @onClose={{@onClose}}
      data-test-create-file-modal
    >
      <:content>
        <FieldContainer @label='Realm' @tag='label' class='field'>
          <RealmDropdown
            class='realm-dropdown-trigger'
            @selectedRealmURL={{this.selectedRealmURL}}
            @onSelect={{this.onSelectRealm}}
          />
        </FieldContainer>
      </:content>
      <:footer>
        <div class='footer-buttons'>
          <Button
            {{on 'click' @onClose}}
            @size='tall'
            data-test-cancel-create-file
          >
            Cancel
          </Button>
          <Button
            @kind='primary'
            @size='tall'
            @disabled={{true}}
            data-test-create-file
          >
            Create
          </Button>
        </div>
      </:footer>
    </ModalContainer>
    <style>
      .create-file-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }
      :deep(.create-file) {
        height: 32rem;
      }
      .boxel-field + .boxel-field {
        margin-top: var(--boxel-sp);
      }
      .field {
        --boxel-field-label-size: 8rem;
      }
      .realm-dropdown-trigger {
        --realm-dropdown-trigger-width: 15.25rem;
      }
      .footer-buttons {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xxs);
      }
    </style>
  </template>

  @tracked selectedRealmURL: URL | undefined = this.args.realmURL;

  @action onSelectRealm({ path }: RealmDropdownItem) {
    this.selectedRealmURL = new URL(path);
  }

  @action removeSelectedRealm() {
    this.selectedRealmURL = undefined;
  }
}
