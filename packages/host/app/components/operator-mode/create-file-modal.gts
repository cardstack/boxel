import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { FieldContainer, Button } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  catalogEntryRef,
  chooseCard,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { codeRefWithAbsoluteURL } from '@cardstack/runtime-common/code-ref';

import type { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

import type CardService from '../../services/card-service';

import ModalContainer from '../modal-container';
import RealmDropdown, { type RealmDropdownItem } from '../realm-dropdown';
import Pill from '../pill';

export type NewFileType = 'card-instance' | 'card-definition'; // TODO: add more types
export const newFileTypes: NewFileType[] = ['card-instance', 'card-definition'];

interface Signature {
  Args: {
    fileType: { id: NewFileType; displayName: string };
    onClose: () => void;
    onSave: (fileURL: URL) => void;
    realmURL?: URL;
  };
}

export default class CreateFileModal extends Component<Signature> {
  <template>
    <ModalContainer
      class='create-file-modal'
      @cardContainerClass='create-file'
      @title='New {{@fileType.displayName}}'
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
        {{#if (eq @fileType.id 'card-instance')}}
          <FieldContainer
            @label='Inherits From'
            class='field'
            data-test-inherits-from-field
          >
            <div class='field-contents'>
              {{#if this.selectedCatalogEntry}}
                <Pill
                  @inert={{true}}
                  data-test-selected-type={{this.selectedCatalogEntry.title}}
                >
                  {{this.selectedCatalogEntry.title}}
                </Pill>
              {{/if}}
              <Button
                class={{if this.selectedCatalogEntry 'change-trigger'}}
                @kind='text-only'
                @size='small'
                @disabled={{this.createCardInstance.isRunning}}
                {{on 'click' (perform this.chooseCardInstanceType)}}
                data-test-select-card-type
              >
                {{if this.selectedCatalogEntry 'Change' 'Select'}}
              </Button>
            </div>
          </FieldContainer>
        {{/if}}
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
            @loading={{this.createCardInstance.isRunning}}
            @disabled={{this.isCreateButtonDisabled}}
            {{on 'click' (perform this.createCardInstance)}}
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
        padding-right: 0;
      }
      .realm-dropdown-trigger {
        --realm-dropdown-trigger-width: 15.25rem;
      }
      .field-contents {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
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

  @service declare cardService: CardService;

  @tracked selectedRealmURL: URL | undefined = this.args.realmURL;
  @tracked selectedCatalogEntry: CatalogEntry | undefined = undefined;

  @action onSelectRealm({ path }: RealmDropdownItem) {
    this.selectedRealmURL = new URL(path);
  }

  @action removeSelectedRealm() {
    this.selectedRealmURL = undefined;
  }

  get isCreateButtonDisabled() {
    return (
      !this.selectedCatalogEntry ||
      !this.selectedRealmURL ||
      this.createCardInstance.isRunning
    );
  }

  private chooseCardInstanceType = restartableTask(async () => {
    this.selectedCatalogEntry = await chooseCard({
      filter: {
        on: catalogEntryRef,
        eq: { isField: false },
      },
    });
  });

  private createCardInstance = restartableTask(async () => {
    if (!this.selectedCatalogEntry?.ref || !this.selectedRealmURL) {
      return;
    }

    let { ref } = this.selectedCatalogEntry;

    let relativeTo = new URL(this.selectedCatalogEntry.id);
    // we make the code ref use an absolute URL for safety in
    // the case it's being created in a different realm than where the card
    // definition comes from
    let maybeRef = codeRefWithAbsoluteURL(ref, relativeTo);
    if ('name' in maybeRef && 'module' in maybeRef) {
      ref = maybeRef;
    }

    let doc: LooseSingleCardDocument = {
      data: {
        meta: {
          adoptsFrom: ref,
          realmURL: this.selectedRealmURL.href,
        },
      },
    };

    let card = await this.cardService.createFromSerialized(doc.data, doc);

    if (!card) {
      throw new Error(
        `Failed to create card from ref "${ref.name}" from "${ref.module}"`,
      );
    }

    await this.cardService.saveModel(this, card);
    this.args.onSave(new URL(`${card.id}.json`));
    this.args.onClose();
  });
}
