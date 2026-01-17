import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import camelCase from 'camelcase';
import { restartableTask, enqueueTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';
import onKeyMod from 'ember-keyboard/modifiers/on-key';
import { consume } from 'ember-provide-consume-context';

import {
  FieldContainer,
  Button,
  BoxelInput,
  BoxelSelect,
  LoadingIndicator,
  Pill,
  RealmIcon,
} from '@cardstack/boxel-ui/components';
import { not, eq, or, and } from '@cardstack/boxel-ui/helpers';
import {
  type Icon,
  CardDefinition,
  CardInstance,
  File,
  Field,
} from '@cardstack/boxel-ui/icons';

import {
  specRef,
  chooseCard,
  baseRealm,
  RealmPaths,
  Deferred,
  SupportedMimeType,
  maybeRelativeURL,
  GetCardContextName,
  isCardInstance,
  type getCard,
  type LocalPath,
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
  type CardErrorJSONAPI,
} from '@cardstack/runtime-common';
import { codeRefWithAbsoluteURL } from '@cardstack/runtime-common/code-ref';

import CopyCardToRealmCommand from '@cardstack/host/commands/copy-card';

import type RealmService from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';
import type { SpecType } from 'https://cardstack.com/base/spec';

import { cleanseString } from '../../lib/utils';

import ModalContainer from '../modal-container';

import RealmDropdown, { type RealmDropdownItem } from '../realm-dropdown';

import WithKnownRealmsLoaded from '../with-known-realms-loaded';

import CardErrorDetail from './card-error-detail';

import type CardService from '../../services/card-service';
import type CommandService from '../../services/command-service';
import type NetworkService from '../../services/network';
import type StoreService from '../../services/store';

export type NewFileType =
  | 'duplicate-instance'
  | 'card-instance'
  | 'card-definition'
  | 'field-definition'
  | 'text-file'
  | 'spec-instance';

export const newFileTypes: {
  id: NewFileType;
  icon?: Icon;
  description?: string;
  extension?: string;
}[] = [
  {
    id: 'duplicate-instance',
    extension: '.json',
  },
  {
    id: 'card-definition',
    icon: CardDefinition,
    description: 'For making apps or templates',
    extension: '.gts',
  },
  {
    id: 'field-definition',
    icon: Field,
    description: 'For structuring data input',
    extension: '.gts',
  },
  {
    id: 'card-instance',
    icon: CardInstance,
    description: 'For storing data or content',
    extension: '.json',
  },
  {
    id: 'text-file',
    icon: File,
    description: 'For plain text or markdown',
    extension: '.txt/.md',
  },
  { id: 'spec-instance', extension: '.json' },
];

export interface FileType {
  id: NewFileType;
  displayName: string;
}

const TEXT_FILE_EXTENSIONS = ['.txt', '.md'];

function textFileExtensionFromInput(input: string) {
  let lower = input.toLowerCase();
  return TEXT_FILE_EXTENSIONS.find((extension) => lower.endsWith(extension));
}

interface Signature {
  Args: {
    owner: object;
    onCreate: (instance: CreateFileModal) => void;
  };
}

export default class CreateFileModal extends Component<Signature> {
  <template>
    <WithKnownRealmsLoaded>
      <:default>
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
            isActive=this.isReady
            focusTrapOptions=(hash
              initialFocus=this.initialFocusSelector allowOutsideClick=true
            )
          }}
          data-test-ready={{this.isReady}}
          data-test-create-file-modal
        >
          <:content>
            {{#if this.isModalOpen}}
              {{#if (not this.isReady)}}
                <LoadingIndicator />
              {{else}}
                <FieldContainer @label='Create In' @tag='label' class='field'>
                  <RealmDropdown
                    class='realm-dropdown'
                    @selectedRealmURL={{this.selectedRealmURL}}
                    @onSelect={{this.onSelectRealm}}
                  />
                </FieldContainer>
                {{#if
                  (and
                    (not (eq this.fileType.id 'duplicate-instance'))
                    (not (eq this.fileType.id 'text-file'))
                  )
                }}
                  <FieldContainer
                    @label={{this.refLabel}}
                    class='field'
                    data-test-inherits-from-field
                  >
                    <div class='field-contents'>
                      {{#if this.definitionClass}}
                        <SelectedTypePill
                          @title={{this.definitionClass.displayName}}
                          @id={{this.definitionClass.ref.module}}
                        />
                      {{else}}
                        {{#if this.selectedSpecResource.card}}
                          <SelectedTypePill
                            @title={{this.selectedSpecResource.card.title}}
                            @id={{this.selectedSpecResource.card.id}}
                          />
                        {{/if}}
                        <Button
                          @kind='text-only'
                          @size='small'
                          @disabled={{this.isCreateRunning}}
                          {{on 'click' (perform this.chooseType)}}
                          data-test-select-card-type
                        >
                          {{if this.selectedSpecResource 'Change' 'Select'}}
                        </Button>
                      {{/if}}
                    </div>
                  </FieldContainer>
                {{/if}}
                {{#if (eq this.fileType.id 'text-file')}}
                  <FieldContainer @label='File Name' @tag='label' class='field'>
                    <BoxelInput
                      data-test-text-file-name-field
                      placeholder='notes'
                      @value={{this.fileName}}
                      @state={{this.fileNameInputState}}
                      @errorMessage={{this.fileNameError}}
                      @onInput={{this.setFileName}}
                    />
                  </FieldContainer>
                  <FieldContainer @label='Extension' @tag='label' class='field'>
                    <BoxelSelect
                      @options={{this.textFileExtensionOptions}}
                      @selected={{this.selectedTextFileExtension}}
                      @onChange={{this.handleTextFileExtensionChange}}
                      @searchEnabled={{false}}
                      @matchTriggerWidth={{true}}
                      @renderInPlace={{true}}
                      data-test-text-file-extension-select
                      as |option|
                    >
                      <span data-test-text-file-extension-option={{option}}>
                        {{option}}
                      </span>
                    </BoxelSelect>
                  </FieldContainer>
                {{/if}}
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
                      @state={{this.fileNameInputState}}
                      @errorMessage={{this.fileNameError}}
                      @onInput={{this.setFileName}}
                    />
                  </FieldContainer>
                {{/if}}
              {{/if}}
            {{/if}}
            {{#if this.saveError}}
              <CardErrorDetail
                class='create-file-error-detail'
                @error={{this.saveError}}
                @headerText={{this.errorHeaderText}}
                data-test-error-container
              />
            {{/if}}
          </:content>
          <:footer>
            {{#if this.isModalOpen}}
              {{#if this.isReady}}
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
                  {{else if (eq this.fileType.id 'text-file')}}
                    <Button
                      @kind='primary'
                      @size='tall'
                      @loading={{this.createTextFile.isRunning}}
                      @disabled={{this.isCreateTextFileButtonDisabled}}
                      {{on 'click' (perform this.createTextFile)}}
                      {{onKeyMod 'Enter'}}
                      data-test-create-text-file
                    >
                      Create
                    </Button>
                  {{/if}}
                </div>
              {{/if}}
            {{/if}}
          </:footer>
        </ModalContainer>
      </:default>
      <:loading></:loading>
    </WithKnownRealmsLoaded>
    <style scoped>
      .create-file-modal {
        --horizontal-gap: var(--boxel-sp-xs);
        --stack-card-footer-height: auto;
      }
      .create-file-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }
      .create-file-modal :deep(.dialog-box__content) {
        display: flex;
        flex-direction: column;
      }

      :deep(.create-file) {
        height: 32rem;
      }
      .field + .field {
        margin-top: var(--boxel-sp-sm);
      }
      .field {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxxs) var(--horizontal-gap);
      }
      .field :deep(.label-container) {
        width: 8rem;
      }
      .field :deep(.content) {
        flex-grow: 1;
        max-width: 100%;
        min-width: 13rem;
      }
      .field .realm-dropdown {
        flex: initial;
      }
      .field-contents {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--horizontal-gap);
      }
      .footer-buttons {
        display: flex;
        margin-left: auto;
        gap: var(--horizontal-gap);
      }
      .gts-extension {
        --gts-label-width: var(--boxel-sp-xxl);
        position: relative;
      }
      .gts-extension input {
        padding-right: var(--gts-label-width);
      }
      .gts-extension:after {
        content: '.gts';
        width: var(--gts-label-width);
        position: absolute;
        display: block;
        right: 0;
        top: var(--boxel-sp-sm);
        color: var(--boxel-450);
        font: 500 var(--boxel-font-sm);
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-lg);
      }
      .create-file-error-detail {
        margin-top: var(--boxel-sp);
      }
    </style>
  </template>

  @consume(GetCardContextName) declare private getCard: getCard<Spec>;

  @service declare private cardService: CardService;
  @service declare private commandService: CommandService;
  @service declare private network: NetworkService;
  @service declare private store: StoreService;

  @tracked private defaultSpecResource: ReturnType<getCard<Spec>> | undefined;
  @tracked private chosenSpecResource: ReturnType<getCard<Spec>> | undefined;
  @tracked private displayName = '';
  @tracked private fileName = '';
  @tracked private hasUserEditedFileName = false;
  @tracked private fileNameError: string | undefined;
  @tracked private selectedTextFileExtension = '.txt';
  @tracked private saveError: CardErrorJSONAPI | undefined;
  @tracked private currentRequest:
    | {
        fileType: FileType;
        newFileDeferred: Deferred<URL | undefined>; // user may close the modal without creating a new file
        realmURL?: URL;
        definitionClass?: {
          displayName: string;
          ref: ResolvedCodeRef;
          specType?: SpecType;
        };
        sourceInstance?: CardDef;
      }
    | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.args.onCreate(this);
  }

  get refLabel() {
    return this.maybeFileType?.id === 'card-instance'
      ? 'Adopted From'
      : this.maybeFileType?.id === 'spec-instance'
        ? 'Code Ref'
        : 'Inherits From';
  }

  // public API for callers to use this component
  async createNewFile(
    fileType: FileType,
    realmURL?: URL,
    definitionClass?: {
      displayName: string;
      ref: ResolvedCodeRef;
      specType?: SpecType;
    },
    sourceInstance?: CardDef,
  ) {
    return await this.makeCreateFileRequest.perform(
      fileType,
      realmURL,
      definitionClass,
      sourceInstance,
    );
  }

  private get isModalOpen() {
    return !!this.currentRequest;
  }

  private get isReady() {
    if (this.definitionClass) {
      return true;
    }
    if (this.maybeFileType?.id === 'text-file') {
      return true;
    }
    return Boolean(this.defaultSpecResource?.isLoaded);
  }

  private get selectedSpecResource() {
    return this.chosenSpecResource || this.defaultSpecResource;
  }

  private makeCreateFileRequest = enqueueTask(
    async (
      fileType: FileType,
      realmURL?: URL,
      definitionClass?: {
        displayName: string;
        ref: ResolvedCodeRef;
        specType?: SpecType;
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
      if (!this.definitionClass) {
        if (this.fileType.id !== 'text-file') {
          let specEntryPath =
            this.fileType.id === 'field-definition'
              ? 'fields/field'
              : 'types/card';
          this.defaultSpecResource = this.getCard(
            this,
            () => `${baseRealm.url}${specEntryPath}`,
          );
        }
      }
      let url = await this.currentRequest.newFileDeferred.promise;
      this.clearState();
      return url;
    },
  );

  private clearState() {
    this.defaultSpecResource = undefined;
    this.chosenSpecResource = undefined;
    this.currentRequest = undefined;
    this.fileNameError = undefined;
    this.displayName = '';
    this.fileName = '';
    this.hasUserEditedFileName = false;
    this.selectedTextFileExtension = '.txt';
    this.clearSaveError();
  }

  private clearSaveError() {
    this.saveError = undefined;
  }

  private get errorHeaderText() {
    if (!this.maybeFileType || this.maybeFileType.id === 'duplicate-instance') {
      return undefined;
    }
    let fileType = this.maybeFileType.displayName.toLowerCase();
    return `Error creating ${fileType}: `;
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
    this.clearSaveError();
    this.currentRequest = { ...this.currentRequest, realmURL: new URL(path) };
  }

  @action private setDisplayName(name: string) {
    this.clearSaveError();
    this.displayName = name;
    if (!this.hasUserEditedFileName) {
      // if the user starts typing in the filename field, then stop helping them
      this.fileName = cleanseString(name);
    }
  }

  @action private setFileName(name: string) {
    this.hasUserEditedFileName = true;
    this.clearSaveError();
    this.fileNameError = undefined;
    if (this.fileType.id === 'text-file') {
      let extension = textFileExtensionFromInput(name);
      if (extension) {
        this.selectedTextFileExtension = extension;
        this.fileName = name.slice(0, -extension.length);
        return;
      }
    }
    this.fileName = name;
  }

  @action private handleTextFileExtensionChange(extension: string) {
    this.clearSaveError();
    this.fileNameError = undefined;
    this.selectedTextFileExtension = extension;
  }

  private get initialFocusSelector() {
    switch (this.maybeFileType?.id) {
      case 'card-instance':
      case 'card-definition':
      case 'field-definition':
      case 'duplicate-instance':
        return '.create-file-modal .realm-dropdown-trigger';
      case 'text-file':
        return '.create-file-modal [data-test-text-file-name-field]';
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
    return this.currentRequest.realmURL?.href;
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
      (!this.selectedSpecResource && !this.definitionClass) ||
      !this.selectedRealmURL ||
      this.createCardInstance.isRunning
    );
  }

  private get isDuplicateCardInstanceButtonDisabled() {
    return !this.selectedRealmURL || this.duplicateCardInstance.isRunning;
  }

  private get isCreateDefinitionButtonDisabled() {
    return (
      (!this.selectedSpecResource && !this.definitionClass) ||
      !this.selectedRealmURL ||
      !this.fileName ||
      !this.displayName ||
      this.createDefinition.isRunning
    );
  }

  private get isCreateTextFileButtonDisabled() {
    return (
      !this.selectedRealmURL ||
      !this.fileName?.trim() ||
      this.createTextFile.isRunning
    );
  }

  private get isCreateRunning() {
    return (
      this.createCardInstance.isRunning ||
      this.createDefinition.isRunning ||
      this.createTextFile.isRunning
    );
  }

  private get textFileExtensionOptions() {
    return TEXT_FILE_EXTENSIONS;
  }

  private getTextFileNameForSave() {
    let trimmed = this.fileName.trim().replace(/^\//, '');
    if (!trimmed) {
      return undefined;
    }
    let extension = textFileExtensionFromInput(trimmed);
    if (extension) {
      return trimmed;
    }
    return `${trimmed}${this.selectedTextFileExtension}`;
  }

  private chooseType = restartableTask(async () => {
    this.clearSaveError();
    let isField = this.fileType.id === 'field-definition';

    let specId = await chooseCard({
      filter: {
        on: specRef,
        every: [{ eq: { specType: isField ? 'field' : 'card' } }],
      },
    });
    this.chosenSpecResource = this.getCard(this, () => specId);
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
        `bug: cannot call createDefinition without a selected realm URL`,
      );
    }
    if (!this.selectedSpecResource && !this.definitionClass) {
      throw new Error(
        `bug: cannot call createDefinition without a selected spec or definitionClass `,
      );
    }
    if (!this.fileName) {
      throw new Error(`bug: cannot call createDefinition without a file name`);
    }
    if (!this.displayName) {
      throw new Error(
        `bug: cannot call createDefinition without a display name`,
      );
    }

    let isField = this.fileType.id === 'field-definition';

    let realmPath = new RealmPaths(new URL(this.selectedRealmURL));
    // assert that filename is a GTS file and is a LocalPath
    let fileName: LocalPath = `${this.fileName.replace(
      /\.[^.].+$/,
      '',
    )}.gts`.replace(/^\//, '');
    let url = realmPath.fileURL(fileName);

    try {
      let response = await this.network.authedFetch(url, {
        headers: { Accept: SupportedMimeType.CardSource },
      });
      if (response.ok) {
        this.fileNameError = `This file already exists`;
        return;
      }
    } catch (err: any) {
      // we expect a 404 here
    }

    let spec: Spec | undefined;
    if (this.selectedSpecResource?.id) {
      let maybeSpec = await this.store.get<Spec>(this.selectedSpecResource.id);
      if (maybeSpec && !isCardInstance(maybeSpec)) {
        throw new Error(`Failed to load spec ${maybeSpec.id}`);
      }
      spec = maybeSpec;
    }

    let {
      ref: { name: exportName, module },
    } = (this.definitionClass ?? spec)!; // we just checked above to make sure one of these exists
    let className = convertToClassName(this.displayName);
    let absoluteModule = new URL(module, spec?.id);
    let moduleURL = maybeRelativeURL(
      absoluteModule,
      url,
      new URL(this.selectedRealmURL),
    );
    let src: string[] = [];

    // There is actually only one possible declaration collision: `className` and `parent`,
    // reconcile that particular collision as necessary.
    if (className === exportName) {
      src.push(`
import { ${exportName} as ${exportName}Parent } from '${moduleURL}';
import { Component } from 'https://cardstack.com/base/card-api';
export class ${className} extends ${exportName}Parent {
  static displayName = "${this.displayName}";`);
    } else if (exportName === 'default') {
      let parent = camelCase(
        module
          .split('/')
          .pop()!
          .replace(/\.[^.]+$/, ''),
        { pascalCase: true },
      );
      // check for parent/className declaration collision
      parent = parent === className ? `${parent}Parent` : parent;
      src.push(`
import ${parent} from '${moduleURL}';
import { Component } from 'https://cardstack.com/base/card-api';
export class ${className} extends ${parent} {
  static displayName = "${this.displayName}";`);
    } else {
      src.push(`
import { ${exportName} } from '${moduleURL}';
import { Component } from 'https://cardstack.com/base/card-api';
export class ${className} extends ${exportName} {
  static displayName = "${this.displayName}";`);
    }
    src.push(`}`);

    try {
      await this.cardService.saveSource(
        url,
        src.join('\n').trim(),
        'create-file',
      );
      this.currentRequest.newFileDeferred.fulfill(url);
    } catch (e: any) {
      let fieldOrCard = isField ? 'field' : 'card';
      console.log(`Error saving ${fieldOrCard} definition`, e);
      this.saveError = e;
    }
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
    let { newCardId } = await new CopyCardToRealmCommand(
      this.commandService.commandContext,
    ).execute({
      sourceCard: this.currentRequest.sourceInstance,
      targetRealm: this.selectedRealmURL,
    });
    this.currentRequest.newFileDeferred.fulfill(new URL(`${newCardId}.json`));
  });

  private createCardInstance = restartableTask(async () => {
    if (!this.currentRequest) {
      throw new Error(
        `Cannot createCardInstance when there is no this.currentRequest`,
      );
    }
    let spec: Spec | undefined;
    if (this.selectedSpecResource?.id) {
      let maybeSpec = await this.store.get<Spec>(this.selectedSpecResource.id);
      if (maybeSpec && !isCardInstance(maybeSpec)) {
        throw new Error(`Failed to load spec ${maybeSpec.id}`);
      }
      spec = maybeSpec;
    }

    if ((!spec?.ref && !this.definitionClass) || !this.selectedRealmURL) {
      throw new Error(
        `bug: cannot create card instance with out adoptsFrom ref and selected realm URL`,
      );
    }

    let { ref } = (this.definitionClass ? this.definitionClass : spec)!; // we just checked above to make sure one of these exist

    let relativeTo = spec
      ? new URL(spec.id!) // only new cards are missing urls
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
          realmURL: this.selectedRealmURL,
        },
      },
    };

    try {
      let maybeId = await this.store.create(doc, {
        relativeTo,
        realm: this.selectedRealmURL,
      });
      if (typeof maybeId !== 'string') {
        let error = maybeId;
        throw error;
      }
      this.currentRequest.newFileDeferred.fulfill(new URL(`${maybeId}.json`));
    } catch (e: any) {
      console.log('Error saving', e);
      this.saveError = e;
    }
  });

  private createTextFile = restartableTask(async () => {
    if (!this.currentRequest) {
      throw new Error(
        `Cannot createTextFile when there is no this.currentRequest`,
      );
    }
    if (!this.selectedRealmURL) {
      throw new Error(
        `bug: cannot call createTextFile without a selected realm URL`,
      );
    }
    if (!this.fileName) {
      throw new Error(`bug: cannot call createTextFile without a file name`);
    }

    let fileName = this.getTextFileNameForSave();
    if (!fileName) {
      return;
    }

    let realmPath = new RealmPaths(new URL(this.selectedRealmURL));
    let filePath: LocalPath = fileName as LocalPath;
    let url = realmPath.fileURL(filePath);

    try {
      let response = await this.network.authedFetch(url, {
        headers: { Accept: SupportedMimeType.CardSource },
      });
      if (response.ok) {
        this.fileNameError = `This file already exists`;
        return;
      }
    } catch (_err: any) {
      // we expect a 404 here
    }

    try {
      await this.cardService.saveSource(url, '', 'create-file');
      this.currentRequest.newFileDeferred.fulfill(url);
    } catch (e: any) {
      console.log('Error saving text file', e);
      this.saveError = e;
    }
  });
}

export function convertToClassName(input: string) {
  // \p{L}: a letter
  let invalidLeadingCharactersRemoved = camelCase(
    input.replace(/^[^\p{L}_$]+/u, ''),
    { pascalCase: true },
  );

  if (!invalidLeadingCharactersRemoved) {
    let prefixedInput = `Class${input}`;
    invalidLeadingCharactersRemoved = camelCase(
      prefixedInput.replace(/^[^\p{L}_$]+/u, ''),
      { pascalCase: true },
    );
  }

  let className = invalidLeadingCharactersRemoved.replace(
    // \p{N}: a number
    /[^\p{L}\p{N}_$]+/gu,
    '',
  );

  // make sure we don't collide with a javascript built-in object
  if (typeof (globalThis as any)[className] !== 'undefined') {
    className = `${className}0`;
  }

  return className;
}

interface SelectedTypePillSignature {
  Args: {
    title: string;
    id: string;
  };
}

export class SelectedTypePill extends Component<SelectedTypePillSignature> {
  @service declare private realm: RealmService;

  <template>
    <Pill class='selected-type' data-test-selected-type={{@title}}>
      <:iconLeft>
        <RealmIcon @realmInfo={{this.realm.info @id}} />
      </:iconLeft>
      <:default>
        <span class='boxel-contents-only' data-test-selected-type-display-name>
          {{@title}}
        </span>
      </:default>
    </Pill>
    <style scoped>
      .selected-type {
        --pill-gap: var(--boxel-sp-xxs);
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs);
        min-height: 2rem;
      }
    </style>
  </template>
}
