import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { FieldContainer, Button } from '@cardstack/boxel-ui/components';
import { IconX } from '@cardstack/boxel-ui/icons';

import ModalContainer from '../modal-container';
import RealmDropdown, { type RealmDropdownItem } from '../realm-dropdown';
import RealmIcon from './realm-icon';
import RealmInfoProvider from './realm-info-provider';
import Pill from '../pill';

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
        <FieldContainer @label='Realm'>
          <div class='field'>
            {{#if this.selectedRealmURL}}
              <RealmInfoProvider @realmURL={{this.selectedRealmURL}}>
                <:ready as |realmInfo|>
                  <Pill class='pill' {{on 'click' this.removeSelectedRealm}}>
                    <:icon>
                      <RealmIcon
                        class='icon'
                        width='20'
                        height='20'
                        @realmIconURL={{realmInfo.iconURL}}
                        @realmName={{realmInfo.name}}
                      />
                    </:icon>
                    <:default>
                      <div class='pill-inner'>
                        <span data-test-realm-name={{realmInfo.name}}>
                          {{realmInfo.name}}
                        </span>
                        <IconX
                          class='remove-icon'
                          width='20'
                          height='20'
                          alt='Remove'
                        />
                      </div>
                    </:default>
                  </Pill>
                </:ready>
              </RealmInfoProvider>
            {{else}}
              No realm selected
            {{/if}}
            <RealmDropdown
              class='change-trigger'
              @selectedRealmURL={{this.selectedRealmURL}}
              @onSelect={{this.onSelectRealm}}
            />
          </div>
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
        display: flex;
        align-items: flex-start;
      }
      .pill {
        height: 1.875rem;
      }
      .pill-inner {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .remove-icon {
        --icon-color: var(--boxel-300);
      }
      .pill:hover .remove-icon {
        --icon-color: var(--boxel-dark);
      }
      .change-trigger {
        margin-left: auto;
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
