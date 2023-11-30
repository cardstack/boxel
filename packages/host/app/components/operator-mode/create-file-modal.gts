import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { capitalize } from '@ember/string';

import { restartableTask, enqueueTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import camelCase from 'lodash/camelCase';

import {
  FieldContainer,
  Button,
  BoxelInput,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { eq, or } from '@cardstack/boxel-ui/helpers';

import {
  catalogEntryRef,
  chooseCard,
  baseRealm,
  RealmPaths,
  Deferred,
  type LocalPath,
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { codeRefWithAbsoluteURL } from '@cardstack/runtime-common/code-ref';

import { getCard } from '@cardstack/host/resources/card-resource';

import type { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

import ModalContainer from '../modal-container';

import Pill from '../pill';
import RealmDropdown, { type RealmDropdownItem } from '../realm-dropdown';
import RealmInfoProvider from './realm-info-provider';
import RealmIcon from './realm-icon';

import type CardService from '../../services/card-service';

export type NewFileType =
  | 'card-instance'
  | 'card-definition'
  | 'field-definition';
export const newFileTypes: NewFileType[] = [
  'card-instance',
  'card-definition',
  'field-definition',
];
const waiter = buildWaiter('create-file-modal:on-setup-waiter');

export interface FileType {
  id: NewFileType;
  displayName: string;
}

interface Signature {
  Args: {
    onCreate: (instance: CreateFileModal) => void;
  };
}

export default class CreateFileModal extends Component<Signature> {
  <template>
    <ModalContainer
      class='create-file-modal'
      @cardContainerClass='create-file'
      @title='New {{this.maybeFileType.displayName}}'
      @size='medium'
      @isOpen={{this.isModalOpen}}
      @onClose={{this.onCancel}}
      data-test-ready={{this.onSetup.isIdle}}
      data-test-create-file-modal
    >
      <:content>
        {{#if this.isModalOpen}}
          {{#if this.onSetup.isRunning}}
            <LoadingIndicator />
          {{else}}
            <FieldContainer @label='Realm' @tag='label' class='field'>
              <RealmDropdown
                @dropdownWidth='15rem'
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
                {{#if this.selectedCatalogEntry}}
                  <SelectedTypePill @entry={{this.selectedCatalogEntry}} />
                {{/if}}
                <Button
                  class={{if this.selectedCatalogEntry 'change-trigger'}}
                  @kind='text-only'
                  @size='small'
                  @disabled={{this.isCreateRunning}}
                  {{on 'click' (perform this.chooseType)}}
                  data-test-select-card-type
                >
                  {{if this.selectedCatalogEntry 'Change' 'Select'}}
                </Button>
              </div>
            </FieldContainer>
            {{#if
              (or
                (eq this.fileType.id 'card-definition')
                (eq this.fileType.id 'field-definition')
              )
            }}
              <FieldContainer @label='Display Name' @tag='label' class='field'>
                <BoxelInput
                  data-test-display-name-field
                  placeholder={{if
                    (eq this.fileType.id 'card-definition')
                    'My Card'
                    'My Field'
                  }}
                  @value={{this.displayName}}
                  @onInput={{this.setDisplayName}}
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
                    {{#if this.definitionClass}}
                      {{this.definitionClass.displayName}}
                    {{else}}
                      {{this.selectedCatalogEntry.title}}
                    {{/if}}
                  </Pill>
                  {{#unless this.definitionClass}}
                    <Button
                      class={{if this.selectedCatalogEntry 'change-trigger'}}
                      @kind='text-only'
                      @size='small'
                      @disabled={{this.createCardInstance.isRunning}}
                      {{on 'click' (perform this.chooseType)}}
                      data-test-select-card-type
                    >
                      {{if this.selectedCatalogEntry 'Change' 'Select'}}
                    </Button>
                  {{/unless}}
                </div>
              </FieldContainer>
              {{#if
                (or
                  (eq this.fileType.id 'card-definition')
                  (eq this.fileType.id 'field-definition')
                )
              }}
                <FieldContainer
                  @label='Display Name'
                  @tag='label'
                  class='field'
                >
                  <BoxelInput
                    data-test-display-name-field
                    placeholder={{if
                      (eq this.fileType.id 'card-definition')
                      'My Card'
                      'My Field'
                    }}
                    @value={{this.displayName}}
                    @onInput={{this.setDisplayName}}
                  />
                </FieldContainer>
                <FieldContainer
                  @label='File Name'
                  @tag='label'
                  class='field gts-extension'
                >
                  <BoxelInput
                    data-test-file-name-field
                    placeholder={{if
                      (eq this.fileType.id 'card-definition')
                      'my-card.gts'
                      'my-field.gts'
                    }}
                    @value={{this.fileName}}
                    @onInput={{this.setFileName}}
                  />
                </FieldContainer>
              {{/if}}
            {{/if}}
          {{/if}}
        {{/if}}
      </:content>
      <:footer>
        {{#if this.isModalOpen}}
          {{#unless this.onSetup.isRunning}}
            <div class='footer-buttons'>
              <Button
                {{on 'click' this.onCancel}}
                @size='tall'
                data-test-cancel-create-file
              >
                Cancel
              </Button>
              {{#if (eq this.fileType.id 'card-instance')}}
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
              {{else if
                (or
                  (eq this.fileType.id 'card-definition')
                  (eq this.fileType.id 'field-definition')
                )
              }}
                <Button
                  @kind='primary'
                  @size='tall'
                  @loading={{this.createDefinition.isRunning}}
                  @disabled={{this.isCreateDefinitionButtonDisabled}}
                  {{on 'click' (perform this.createDefinition)}}
                  data-test-create-definition
                >
                  Create
                </Button>
              {{/if}}
            </div>
          {{/unless}}
        {{/if}}
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
      .gts-extension {
        position: relative;
      }
      .gts-extension input {
        padding-right: var(--boxel-sp-xxl);
      }
      .gts-extension:after {
        content: '.gts';
        width: var(--boxel-sp-xxl);
        height: 20px;
        position: absolute;
        display: block;
        right: -5px;
        top: 10px;
        color: var(--boxel-450);
        font: var(--boxel-font-sm);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-lg);
        line-height: 1.82;
      }
    </style>
  </template>

  @service private declare cardService: CardService;

  @tracked private selectedCatalogEntry: CatalogEntry | undefined = undefined;
  @tracked private displayName = '';
  @tracked private fileName = '';
  @tracked private currentRequest:
    | {
        fileType: FileType;
        newFileDeferred: Deferred<URL | undefined>; // user may close the modal without creating a new file
        realmURL?: URL;
        definitionClass?: {
          displayName: string;
          ref: ResolvedCodeRef;
        };
      }
    | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.args.onCreate(this);
  }

  // public API for callers to use this component
  async createNewFile(
    fileType: FileType,
    realmURL?: URL,
    definitionClass?: {
      displayName: string;
      ref: ResolvedCodeRef;
    },
  ) {
    return await this.makeCreateFileRequst.perform(
      fileType,
      realmURL,
      definitionClass,
    );
  }

  // public API
  get isModalOpen() {
    return !!this.currentRequest;
  }

  private makeCreateFileRequst = enqueueTask(
    async (
      fileType: FileType,
      realmURL?: URL,
      definitionClass?: {
        displayName: string;
        ref: ResolvedCodeRef;
      },
    ) => {
      this.currentRequest = {
        fileType,
        newFileDeferred: new Deferred(),
        realmURL,
        definitionClass,
      };
      await this.onSetup.perform();
      let url = await this.currentRequest.newFileDeferred.promise;
      this.currentRequest = undefined;
      return url;
    },
  );

  @action private onCancel() {
    this.currentRequest?.newFileDeferred.fulfill(undefined);
  }

  @action private onSelectRealm({ path }: RealmDropdownItem) {
    if (!this.currentRequest) {
      throw new Error(
        `Cannot select realm when there is no this.currentRequest`,
      );
    }
    this.currentRequest.realmURL = new URL(path);
  }

  @action private setDisplayName(name: string) {
    this.displayName = name;
  }

  @action private setFileName(name: string) {
    this.fileName = name;
  }

  private get maybeFileType() {
    return this.currentRequest?.fileType;
  }

  private get fileType() {
    if (!this.currentRequest) {
      throw new Error(
        `Cannot determine fileType when there is no this.currentRequest`,
      );
    }
    return this.currentRequest.fileType;
  }

  private get selectedRealmURL() {
    if (!this.currentRequest) {
      throw new Error(
        `Cannot determine selectedRealmURL when there is no this.currentRequest`,
      );
    }
    return this.currentRequest.realmURL;
  }

  private get definitionClass() {
    if (!this.currentRequest) {
      throw new Error(
        `Cannot determine definitionClass when there is no this.currentRequest`,
      );
    }
    return this.currentRequest.definitionClass;
  }

  private get isCreateCardInstanceButtonDisabled() {
    return (
      !this.selectedCatalogEntry ||
      !this.selectedRealmURL ||
      this.createCardInstance.isRunning
    );
  }

  private get isCreateDefinitionButtonDisabled() {
    return (
      (!this.selectedCatalogEntry && !this.definitionClass) ||
      !this.selectedRealmURL ||
      !this.fileName ||
      !this.displayName ||
      this.createDefinition.isRunning
    );
  }

  private get isCreateRunning() {
    return this.createCardInstance.isRunning || this.createDefinition.isRunning;
  }

  private onSetup = restartableTask(async () => {
    if (this.fileType.id === 'card-instance') {
      return;
    }
    let token = waiter.beginAsync();

    try {
      if (!this.definitionClass) {
        let fieldOrCard =
          this.fileType.id === 'field-definition' ? 'field' : 'card';

        let resource = getCard(
          this,
          () => `${baseRealm.url}types/${fieldOrCard}`,
          {
            isLive: () => false,
          },
        );
        await resource.loaded;

        this.selectedCatalogEntry = resource.card as CatalogEntry;
      }
    } finally {
      waiter.endAsync(token);
    }
  });

  private chooseType = restartableTask(async () => {
    let isField = this.fileType.id === 'field-definition';
    this.selectedCatalogEntry = await chooseCard({
      filter: {
        on: catalogEntryRef,
        eq: { isField },
      },
    });
  });

  // this can be used for CardDefs or FieldDefs
  private createDefinition = restartableTask(async () => {
    if (!this.currentRequest) {
      throw new Error(
        `Cannot createDefinition when there is no this.currentRequest`,
      );
    }
    if (!this.selectedRealmURL) {
      throw new Error(
        `bug: cannot call createCardDefinition without a selected realm URL`,
      );
    }
    if (!this.selectedCatalogEntry && !this.definitionClass) {
      throw new Error(
        `bug: cannot call createCardDefinition without a selected catalog entry or definitionClass `,
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
    let {
      ref: { name: exportName, module },
    } = (this.definitionClass ?? this.selectedCatalogEntry)!; // we just checked above to make sure one of these exists
    let className = camelize(this.displayName);
    let absoluteModule = new URL(module, this.selectedCatalogEntry?.id).href;
    // sanitize the name since it will be used in javascript code
    let safeName = this.displayName.replace(/[^A-Za-z \d-_]/g, '').trim();
    let src: string;
    if (exportName === 'default') {
      // we don't have to worry about declaration collisions with 'parent' since we own the entire module
      let parent = camelize(
        module
          .split('/')
          .pop()!
          .replace(/\.[^\.]+$/, ''),
      );
      src = `
import ${parent} from '${absoluteModule}';
export class ${className} extends ${parent} {
  static displayName = "${safeName}";
}`;
    } else {
      src = `
import { ${exportName} } from '${absoluteModule}';
export class ${className} extends ${exportName} {
  static displayName = "${safeName}";
}`;
    }
    let realmPath = new RealmPaths(this.selectedRealmURL);
    // assert that filename is a GTS file and is a LocalPath
    let fileName: LocalPath = `${this.fileName.replace(
      /\.[^\.].+$/,
      '',
    )}.gts`.replace(/^\//, '');
    let url = realmPath.fileURL(fileName);
    await this.cardService.saveSource(url, src);
    this.currentRequest.newFileDeferred.fulfill(url);
  });

  private createCardInstance = restartableTask(async () => {
    if (!this.currentRequest) {
      throw new Error(
        `Cannot createCardInstance when there is no this.currentRequest`,
      );
    }
    if (!this.selectedCatalogEntry?.ref || !this.selectedRealmURL) {
      return;
    }

    let { ref } = this.definitionClass
      ? this.definitionClass
      : this.selectedCatalogEntry;

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
    this.currentRequest.newFileDeferred.fulfill(new URL(`${card.id}.json`));
  });
}

function camelize(name: string) {
  return capitalize(camelCase(name));
}

const SelectedTypePill: TemplateOnlyComponent<{
  entry: CatalogEntry;
}> = <template>
  <Pill
    @inert={{true}}
    class='selected-type'
    data-test-selected-type={{@entry.title}}
  >
    <:icon>
      <RealmInfoProvider @fileURL={{@entry.id}}>
        <:ready as |realmInfo|>
          <RealmIcon
            @realmIconURL={{realmInfo.iconURL}}
            @realmName={{realmInfo.name}}
          />
        </:ready>
      </RealmInfoProvider>
    </:icon>
    <:default>
      {{@entry.title}}
    </:default>
  </Pill>
  <style>
    .selected-type {
      padding: var(--boxel-sp-xxxs);
      gap: var(--boxel-sp-xxxs);
    }
    .selected-type :deep(.icon) {
      margin-right: 0;
    }
  </style>
</template>;
