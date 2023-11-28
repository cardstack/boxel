import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type Owner from '@ember/owner';
import { buildWaiter } from '@ember/test-waiters';

import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import camelCase from 'lodash/camelCase';

import {
  FieldContainer,
  Button,
  BoxelInput,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  catalogEntryRef,
  chooseCard,
  baseRealm,
  RealmPaths,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { codeRefWithAbsoluteURL } from '@cardstack/runtime-common/code-ref';
import { getCard } from '@cardstack/host/resources/card-resource';

import type { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

import type CardService from '../../services/card-service';

import ModalContainer from '../modal-container';
import RealmDropdown, { type RealmDropdownItem } from '../realm-dropdown';
import Pill from '../pill';

export type NewFileType = 'card-instance' | 'card-definition'; // TODO: add more types
export const newFileTypes: NewFileType[] = ['card-instance', 'card-definition'];
const waiter = buildWaiter('create-file-modal:on-setup-waiter');

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
      data-test-ready={{this.onSetup.isIdle}}
      data-test-create-file-modal
    >
      <:content>
        {{#if this.onSetup.isRunning}}
          <LoadingIndicator />
        {{else}}
          <FieldContainer @label='Realm' @tag='label' class='field'>
            <RealmDropdown
              class='realm-dropdown-trigger'
              @selectedRealmURL={{this.selectedRealmURL}}
              @onSelect={{this.onSelectRealm}}
            />
          </FieldContainer>
          <FieldContainer
            @label='Inherits From'
            class='field'
            data-test-inherits-from-field
          >
            <div class='field-contents'>
              <Pill
                @inert={{true}}
                data-test-selected-type={{this.selectedCatalogEntry.title}}
              >
                {{this.selectedCatalogEntry.title}}
              </Pill>
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
          {{#if (eq @fileType.id 'card-definition')}}
            <FieldContainer @label='Display Name' @tag='label' class='field'>
              <BoxelInput
                data-test-display-name-field
                placeholder='My Card'
                @state={{this.displayNameState}}
                @value={{this.displayName}}
                @errorMessage={{this.displayNameError}}
                @onInput={{this.setDisplayName}}
              />
            </FieldContainer>
            <FieldContainer @label='File Name' @tag='label' class='field'>
              {{! TODO add ".gts" suffix }}
              <BoxelInput
                data-test-file-name-field
                placeholder='my-card.gts'
                @state={{this.fileNameState}}
                @value={{this.fileName}}
                @errorMessage={{this.fileNameError}}
                @onInput={{this.setFileName}}
              />
            </FieldContainer>
          {{/if}}
        {{/if}}
      </:content>
      <:footer>
        {{#unless this.onSetup.isRunning}}
          <div class='footer-buttons'>
            <Button
              {{on 'click' @onClose}}
              @size='tall'
              data-test-cancel-create-file
            >
              Cancel
            </Button>
            {{! TODO can we collapse these? }}
            {{#if (eq @fileType.id 'card-instance')}}
              <Button
                @kind='primary'
                @size='tall'
                @loading={{this.createCardInstance.isRunning}}
                @disabled={{this.isCreateCardInstanceButtonDisabled}}
                {{on 'click' (perform this.createCardInstance)}}
                data-test-create-card-instance
              >
                Create
              </Button>
            {{else if (eq @fileType.id 'card-definition')}}
              <Button
                @kind='primary'
                @size='tall'
                @loading={{this.createCardDefinition.isRunning}}
                @disabled={{this.isCreateCardDefinitionButtonDisabled}}
                {{on 'click' (perform this.createCardDefinition)}}
                data-test-create-card-definition
              >
                Create
              </Button>
            {{/if}}
          </div>
        {{/unless}}
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

  @service private declare cardService: CardService;

  @tracked private selectedRealmURL: URL | undefined = this.args.realmURL;
  @tracked private selectedCatalogEntry: CatalogEntry | undefined = undefined;
  @tracked private displayName = '';
  @tracked private displayNameError: string | undefined;
  @tracked private fileName = '';
  @tracked private fileNameError: string | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.onSetup.perform();
  }

  @action private onSelectRealm({ path }: RealmDropdownItem) {
    this.selectedRealmURL = new URL(path);
  }

  @action private setDisplayName(name: string) {
    this.displayNameError = undefined;
    this.displayName = name;
  }

  @action private setFileName(name: string) {
    this.fileNameError = undefined;
    this.fileName = name;
  }

  private get displayNameState() {
    return this.displayNameError ? 'invalid' : 'initial';
  }

  private get fileNameState() {
    return this.fileNameError ? 'invalid' : 'initial';
  }

  private get isCreateCardInstanceButtonDisabled() {
    return (
      !this.selectedCatalogEntry ||
      !this.selectedRealmURL ||
      this.createCardInstance.isRunning
    );
  }

  private get isCreateCardDefinitionButtonDisabled() {
    return (
      !this.selectedCatalogEntry ||
      !this.selectedRealmURL ||
      this.createCardDefinition.isRunning
    );
  }

  private onSetup = restartableTask(async () => {
    let token = waiter.beginAsync();
    try {
      if (this.args.fileType.id === 'card-definition') {
        let resource = getCard(this, () => `${baseRealm.url}types/card`, {
          isLive: () => false,
        });
        await resource.loaded;
        this.selectedCatalogEntry = resource.card as CatalogEntry;
      }
    } finally {
      waiter.endAsync(token);
    }
  });

  private chooseCardInstanceType = restartableTask(async () => {
    this.selectedCatalogEntry = await chooseCard({
      filter: {
        on: catalogEntryRef,
        eq: { isField: false },
      },
    });
  });

  private createCardDefinition = restartableTask(async () => {
    if (!this.selectedRealmURL) {
      throw new Error(
        `bug: cannot call createCardDefinition without a selected realm URL`,
      );
    }
    if (!this.selectedCatalogEntry) {
      throw new Error(
        `bug: cannot call createCardDefinition without a selected catalog entry`,
      );
    }
    if (!this.fileName) {
      throw new Error(
        `bug: cannot call createCardDefinition without a file name`,
      );
    }
    if (!this.displayName) {
      throw new Error(
        `bug: cannot call createCardDefinition without a display name`,
      );
    }
    let { name: exportName, module } = this.selectedCatalogEntry.ref;
    let className = camelCase(this.displayName).replace(/^./, (c) =>
      c.toUpperCase(),
    );
    // sanitize the name since it will be used in javascript code
    let safeName = this.displayName.replace(/[^A-Za-z \d-_]/g, '').trim();
    let src = `
import { ${exportName} } from '${module}';
export class ${className} extends ${exportName} {
  static displayName = "${safeName}";
}
    `;
    let realmPath = new RealmPaths(this.selectedRealmURL);
    let basename = this.fileName.split('.');
    basename.pop();
    let fileName = `${basename.join()}.gts`.replace(/^\//, '');
    let url = realmPath.fileURL(fileName);
    await this.cardService.saveSource(url, src);
    this.args.onSave(url);
    this.args.onClose();
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
