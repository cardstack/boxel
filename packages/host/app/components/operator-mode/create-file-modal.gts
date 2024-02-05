import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { capitalize } from '@ember/string';
import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, enqueueTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';
import onKeyMod from 'ember-keyboard/modifiers/on-key';
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
  SupportedMimeType,
  maybeRelativeURL,
  type LocalPath,
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { codeRefWithAbsoluteURL } from '@cardstack/runtime-common/code-ref';

import { getCard } from '@cardstack/host/resources/card-resource';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

import ModalContainer from '../modal-container';

import Pill from '../pill';
import RealmDropdown, { type RealmDropdownItem } from '../realm-dropdown';

import RealmIcon from './realm-icon';
import RealmInfoProvider from './realm-info-provider';

import type CardService from '../../services/card-service';
import type LoaderService from '../../services/loader-service';

export type NewFileType =
  | 'duplicate-instance'
  | 'card-instance'
  | 'card-definition'
  | 'field-definition';
export const newFileTypes: NewFileType[] = [
  'duplicate-instance',
  'card-definition',
  'field-definition',
  'card-instance',
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
      @title='{{if
        (eq this.maybeFileType.id "duplicate-instance")
        "Duplicate"
        "New"
      }} {{this.maybeFileType.displayName}}'
      @size='medium'
      @isOpen={{this.isModalOpen}}
      @onClose={{this.onCancel}}
      {{focusTrap
        isActive=this.onSetup.isIdle
        focusTrapOptions=(hash
          initialFocus=this.initialFocusSelector allowOutsideClick=true
        )
      }}
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
            {{#unless (eq this.fileType.id 'duplicate-instance')}}
              <FieldContainer
                @label={{if
                  (eq this.maybeFileType.id 'card-instance')
                  'Adopted From'
                  'Inherits From'
                }}
                class='field'
                data-test-inherits-from-field
              >
                <div class='field-contents'>
                  {{#if this.definitionClass}}
                    <Pill @inert={{true}}>
                      {{this.definitionClass.displayName}}
                    </Pill>
                  {{else}}
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
                  {{/if}}
                </div>
              </FieldContainer>
            {{/unless}}
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
                  @state={{this.fileNameInputState}}
                  @errorMessage={{this.fileNameError}}
                  @onInput={{this.setFileName}}
                />
              </FieldContainer>
            {{/if}}
          {{/if}}
        {{/if}}
        {{#if this.saveError}}
          <div class='error-message' data-test-error-message>
            {{this.saveError}}
          </div>
        {{/if}}
      </:content>
      <:footer>
        {{#if this.isModalOpen}}
          {{#unless this.onSetup.isRunning}}
            <div class='footer-buttons'>
              <Button
                {{on 'click' this.onCancel}}
                {{onKeyMod 'Escape'}}
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
                  {{onKeyMod 'Enter'}}
                  data-test-create-card-instance
                >
                  Create
                </Button>
              {{else if (eq this.fileType.id 'duplicate-instance')}}
                <Button
                  @kind='primary'
                  @size='tall'
                  @loading={{this.duplicateCardInstance.isRunning}}
                  @disabled={{this.isDuplicateCardInstanceButtonDisabled}}
                  {{on 'click' (perform this.duplicateCardInstance)}}
                  {{onKeyMod 'Enter'}}
                  data-test-duplicate-card-instance
                >
                  Duplicate
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
                  {{onKeyMod 'Enter'}}
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
        margin-left: auto;
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
      .error-message {
        color: var(--boxel-error-100);
        margin-top: var(--boxel-sp-lg);
      }
    </style>
  </template>

  @service private declare cardService: CardService;
  @service declare loaderService: LoaderService;

  @tracked private selectedCatalogEntry: CatalogEntry | undefined = undefined;
  @tracked private displayName = '';
  @tracked private fileName = '';
  @tracked private fileNameError: string | undefined;
  @tracked private saveError: string | undefined;
  @tracked private currentRequest:
    | {
        fileType: FileType;
        newFileDeferred: Deferred<URL | undefined>; // user may close the modal without creating a new file
        realmURL?: URL;
        definitionClass?: {
          displayName: string;
          ref: ResolvedCodeRef;
        };
        sourceInstance?: CardDef;
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
    sourceInstance?: CardDef,
  ) {
    return await this.makeCreateFileRequst.perform(
      fileType,
      realmURL,
      definitionClass,
      sourceInstance,
    );
  }

  private get isModalOpen() {
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
      sourceInstance?: CardDef,
    ) => {
      this.currentRequest = {
        fileType,
        newFileDeferred: new Deferred(),
        realmURL,
        definitionClass,
        sourceInstance,
      };
      await this.onSetup.perform();
      let url = await this.currentRequest.newFileDeferred.promise;
      this.clearState();
      return url;
    },
  );

  private clearState() {
    this.selectedCatalogEntry = undefined;
    this.currentRequest = undefined;
    this.fileNameError = undefined;
    this.saveError = undefined;
    this.displayName = '';
    this.fileName = '';
  }

  private get fileNameInputState() {
    return this.fileNameError ? 'invalid' : 'initial';
  }

  @action private onCancel() {
    this.currentRequest?.newFileDeferred.fulfill(undefined);
    this.clearState();
  }

  @action private onSelectRealm({ path }: RealmDropdownItem) {
    if (!this.currentRequest) {
      throw new Error(
        `Cannot select realm when there is no this.currentRequest`,
      );
    }
    this.currentRequest = { ...this.currentRequest, realmURL: new URL(path) };
  }

  @action private setDisplayName(name: string) {
    this.displayName = name;
  }

  @action private setFileName(name: string) {
    this.fileNameError = undefined;
    this.fileName = name;
  }

  private get initialFocusSelector() {
    switch (this.maybeFileType?.id) {
      case 'card-instance':
      case 'card-definition':
      case 'field-definition':
      case 'duplicate-instance':
        return '.create-file-modal .realm-dropdown-trigger';
      default:
        return false;
    }
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
      (!this.selectedCatalogEntry && !this.definitionClass) ||
      !this.selectedRealmURL ||
      this.createCardInstance.isRunning
    );
  }

  private get isDuplicateCardInstanceButtonDisabled() {
    return !this.selectedRealmURL || this.duplicateCardInstance.isRunning;
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
    let token = waiter.beginAsync();
    try {
      if (!this.definitionClass) {
        let catalogEntryPath =
          this.fileType.id === 'field-definition'
            ? 'fields/field'
            : 'types/card';
        let resource = getCard(
          this,
          () => `${baseRealm.url}${catalogEntryPath}`,
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

    let realmPath = new RealmPaths(this.selectedRealmURL);
    // assert that filename is a GTS file and is a LocalPath
    let fileName: LocalPath = `${this.fileName.replace(
      /\.[^.].+$/,
      '',
    )}.gts`.replace(/^\//, '');
    let url = realmPath.fileURL(fileName);

    let response = await this.loaderService.loader.fetch(url, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (response.ok) {
      this.fileNameError = `This file already exists`;
      return;
    }

    let {
      ref: { name: exportName, module },
    } = (this.definitionClass ?? this.selectedCatalogEntry)!; // we just checked above to make sure one of these exists
    let className = camelize(this.displayName);
    // make sure we don't collide with a javascript built-in object
    if (typeof (globalThis as any)[className] !== 'undefined') {
      className = `${className}0`;
    }
    let absoluteModule = new URL(module, this.selectedCatalogEntry?.id);
    let moduleURL = maybeRelativeURL(
      absoluteModule,
      url,
      this.selectedRealmURL,
    );
    // sanitize the name since it will be used in javascript code
    let safeName = this.displayName.replace(/[^A-Za-z \d-_]/g, '').trim();
    let src: string[] = [];

    // There is actually only one possible declaration collision: `className` and `parent`,
    // reconcile that particular collision as necessary.
    if (className === exportName) {
      src.push(`
import { ${exportName} as ${exportName}Parent } from '${moduleURL}';
import { Component } from 'https://cardstack.com/base/card-api';
export class ${className} extends ${exportName}Parent {
  static displayName = "${safeName}";`);
    } else if (exportName === 'default') {
      let parent = camelize(
        module
          .split('/')
          .pop()!
          .replace(/\.[^.]+$/, ''),
      );
      // check for parent/className declaration collision
      parent = parent === className ? `${parent}Parent` : parent;
      src.push(`
import ${parent} from '${moduleURL}';
import { Component } from 'https://cardstack.com/base/card-api';
export class ${className} extends ${parent} {
  static displayName = "${safeName}";`);
    } else {
      src.push(`
import { ${exportName} } from '${moduleURL}';
import { Component } from 'https://cardstack.com/base/card-api';
export class ${className} extends ${exportName} {
  static displayName = "${safeName}";`);
    }
    src.push(`\n  /*`);
    if (this.fileType.id === 'card-definition') {
      src.push(
        `  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }
`,
      );
    }
    src.push(
      `  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }`,
    );
    src.push(`  */`);
    src.push(`}`);

    await this.cardService.saveSource(url, src.join('\n').trim());
    this.currentRequest.newFileDeferred.fulfill(url);
  });

  private duplicateCardInstance = restartableTask(async () => {
    if (!this.currentRequest) {
      throw new Error(
        `Cannot duplicateCardInstance when there is no this.currentRequest`,
      );
    }
    if (!this.currentRequest.sourceInstance) {
      throw new Error(
        `Cannot duplicateCardInstance when there is no sourceInstance`,
      );
    }
    if (!this.selectedRealmURL) {
      throw new Error(
        `Cannot duplicateCardInstance where where is no selected realm URL`,
      );
    }
    let duplicate = await this.cardService.copyCard(
      this.currentRequest.sourceInstance,
      this.selectedRealmURL,
    );
    let saved = await this.cardService.saveModel(this, duplicate);
    if (!saved) {
      throw new Error(`unable to save duplicated card instance`);
    }
    this.currentRequest.newFileDeferred.fulfill(new URL(`${saved.id}.json`));
  });

  private createCardInstance = restartableTask(async () => {
    if (!this.currentRequest) {
      throw new Error(
        `Cannot createCardInstance when there is no this.currentRequest`,
      );
    }
    if (
      (!this.selectedCatalogEntry?.ref && !this.definitionClass) ||
      !this.selectedRealmURL
    ) {
      throw new Error(
        `bug: cannot create card instance with out adoptsFrom ref and selected realm URL`,
      );
    }

    let { ref } = (
      this.definitionClass ? this.definitionClass : this.selectedCatalogEntry
    )!; // we just checked above to make sure one of these exist

    let relativeTo = this.selectedCatalogEntry
      ? new URL(this.selectedCatalogEntry.id)
      : undefined;
    // we make the code ref use an absolute URL for safety in
    // the case it's being created in a different realm than where the card
    // definition comes from. The server will make relative URL if appropriate after creation
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

    try {
      let card = await this.cardService.createFromSerialized(doc.data, doc);

      if (!card) {
        throw new Error(
          `Failed to create card from ref "${ref.name}" from "${ref.module}"`,
        );
      }
      await this.cardService.saveModel(this, card);
      this.currentRequest.newFileDeferred.fulfill(new URL(`${card.id}.json`));
    } catch (e: any) {
      console.log('Error saving', e);
      this.saveError = `Error creating card instance: ${e.message}`;
    }
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
