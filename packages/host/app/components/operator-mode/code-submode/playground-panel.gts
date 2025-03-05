import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Folder from '@cardstack/boxel-icons/folder';
import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import window from 'ember-window-mock';
import { TrackedObject } from 'tracked-built-ins';

import {
  LoadingIndicator,
  BoxelSelect,
  CardContainer,
  CardHeader,
} from '@cardstack/boxel-ui/components';
import { eq, or, MenuItem } from '@cardstack/boxel-ui/helpers';
import {
  Eye,
  IconCode,
  IconLink,
  IconPlusThin,
} from '@cardstack/boxel-ui/icons';

import {
  cardTypeDisplayName,
  cardTypeIcon,
  chooseCard,
  identifyCard,
  internalKeyFor,
  loadCard,
  specRef,
  type Query,
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { getCard } from '@cardstack/host/resources/card-resource';

import type CardService from '@cardstack/host/services/card-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type RealmService from '@cardstack/host/services/realm';
import type { EnhancedRealmInfo } from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import type {
  CardDef,
  FieldDef,
  Format,
} from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';

import PrerenderedCardSearch, {
  type PrerenderedCard,
} from '../../prerendered-card-search';

import Preview from '../../preview';
import FittedFormatGallery from '../card-preview-panel/fitted-format-gallery';

import FormatChooser from './format-chooser';

const getItemTitle = (item: CardDef) => {
  if (!item) {
    return;
  }
  return item.title ?? `Untitled ${cardTypeDisplayName(item)}`;
};

const isSpec = (card: CardDef, cardRef?: ResolvedCodeRef): card is Spec => {
  if (!cardRef) {
    cardRef = identifyCard(card.constructor) as ResolvedCodeRef | undefined;
  }
  return cardRef?.name === specRef.name && cardRef.module === specRef.module;
}

const SelectedItem: TemplateOnlyComponent<{ Args: { title?: string } }> =
  <template>
    <div class='selected-item'>
      Instance:
      <span class='title' data-test-selected-item>
        {{@title}}
      </span>
    </div>
    <style scoped>
      .selected-item {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        overflow: hidden;
        font: 600 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .title {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
    </style>
  </template>;

const BeforeOptions: TemplateOnlyComponent = <template>
  <div class='before-options'>
    <span class='title'>
      Recent
    </span>
  </div>
  <style scoped>
    .before-options {
      width: 100%;
      background-color: var(--boxel-light);
      padding: var(--boxel-sp-xs) calc(var(--boxel-sp-xxs) + var(--boxel-sp-xs))
        0 calc(var(--boxel-sp-xxs) + var(--boxel-sp-xs));
    }
    .title {
      font: 600 var(--boxel-font-sm);
    }
  </style>
</template>;

interface AfterOptionsSignature {
  Args: {
    chooseCard: () => void;
    createNew?: () => void;
    createNewIsRunning?: boolean;
  };
}
const AfterOptions: TemplateOnlyComponent<AfterOptionsSignature> = <template>
  <div class='after-options'>
    <span class='title'>
      Action
    </span>
    {{#if @createNew}}
      <button
        class='action'
        {{on 'click' @createNew}}
        data-test-create-instance
      >
        {{#if @createNewIsRunning}}
          <LoadingIndicator class='action-running' />
        {{else}}
          <IconPlusThin width='16px' height='16px' />
        {{/if}}
        Create new instance
      </button>
    {{/if}}
    <button
      class='action'
      {{on 'click' @chooseCard}}
      data-test-choose-another-instance
    >
      <Folder width='16px' height='16px' />
      Choose another instance
    </button>
  </div>
  <style scoped>
    .after-options {
      display: flex;
      flex-direction: column;
      border-top: var(--boxel-border);
      background-color: var(--boxel-light);
      padding: var(--boxel-sp-xs);
      gap: var(--boxel-sp-xxs);
    }
    .title {
      font: 600 var(--boxel-font-sm);
      padding: 0 var(--boxel-sp-xxs);
    }
    .action {
      display: flex;
      align-items: center;
      font: 500 var(--boxel-font-sm);
      border: none;
      background-color: transparent;
      gap: var(--boxel-sp-xs);
      padding: var(--boxel-sp-xs);
      border-radius: var(--boxel-border-radius);
    }
    .action:hover {
      background-color: var(--boxel-100);
    }
    .action-running {
      --boxel-loading-indicator-size: 16px;
    }
  </style>
</template>;

interface DropdownSignature {
  Args: {
    query: Query;
    realms: string[];
    card: CardDef | undefined;
    onSelect: (card: PrerenderedCard) => void;
    chooseCard: () => void;
    createNew?: () => void;
    createNewIsRunning?: boolean;
  };
}
const InstanceSelectDropdown: TemplateOnlyComponent<DropdownSignature> =
  <template>
    <PrerenderedCardSearch
      @query={{@query}}
      @format='fitted'
      @realms={{@realms}}
    >
      <:loading>
        <LoadingIndicator class='loading-icon' @color='var(--boxel-light)' />
      </:loading>
      <:response as |cards|>
        <BoxelSelect
          class='instance-chooser'
          @dropdownClass='instances-dropdown-content'
          @options={{cards}}
          @selected={{@card}}
          @selectedItemComponent={{if
            @card
            (component SelectedItem title=(getItemTitle @card))
          }}
          @renderInPlace={{true}}
          @onChange={{@onSelect}}
          @placeholder='Please Select'
          @beforeOptionsComponent={{component BeforeOptions}}
          @afterOptionsComponent={{component
            AfterOptions
            chooseCard=@chooseCard
            createNew=@createNew
            createNewIsRunning=@createNewIsRunning
          }}
          data-playground-instance-chooser
          data-test-instance-chooser
          as |card|
        >
          <CardContainer class='card' @displayBoundaries={{true}}>
            <card.component />
          </CardContainer>
        </BoxelSelect>
      </:response>
    </PrerenderedCardSearch>

    <style scoped>
      .loading-icon {
        height: var(--boxel-form-control-height);
      }
      .instance-chooser {
        width: 405px;
        max-width: 100%;
        height: var(--boxel-form-control-height);
        box-shadow: 0 5px 10px 0 rgba(0 0 0 / 40%);
      }
      :deep(
        .boxel-select__dropdown .ember-power-select-option[aria-current='true']
      ),
      :deep(.instances-dropdown-content .ember-power-select-option) {
        background-color: var(--boxel-light);
      }
      :deep(.ember-power-select-option:hover .card) {
        background-color: var(--boxel-100);
      }
      .card {
        height: 75px;
        width: 375px;
        max-width: 100%;
        container-name: fitted-card;
        container-type: size;
        background-color: var(--boxel-light);
      }
    </style>
  </template>;

interface PlaygroundPreviewSignature {
  Args: {
    format: Format;
    card: CardDef | FieldDef;
    isFieldDef?: boolean;
    realmInfo?: EnhancedRealmInfo;
    contextMenuItems?: MenuItem[];
    onEdit?: () => void;
    onFinishEditing?: () => void;
  };
}
const PlaygroundPreview: TemplateOnlyComponent<PlaygroundPreviewSignature> =
  // For fields, the innermost CardContainer represents a card that's embedding this field in available field formats
  <template>
    {{#if @isFieldDef}}
      <CardContainer class='preview-container full-height-preview'>
        <CardHeader
          class='preview-header'
          @cardTypeDisplayName={{cardTypeDisplayName @card}}
          @cardTypeIcon={{cardTypeIcon @card}}
          @realmInfo={{@realmInfo}}
          @onEdit={{@onEdit}}
          @onFinishEditing={{@onFinishEditing}}
          @isTopCard={{true}}
        />
        <CardContainer class='field-preview-card'>
          <Preview @card={{@card}} @format={{@format}} />
        </CardContainer>
      </CardContainer>
    {{else}}
      {{#if (or (eq @format 'isolated') (eq @format 'edit'))}}
        <CardContainer class='preview-container full-height-preview'>
          <CardHeader
            class='preview-header'
            @cardTypeDisplayName={{cardTypeDisplayName @card}}
            @cardTypeIcon={{cardTypeIcon @card}}
            @realmInfo={{@realmInfo}}
            @onEdit={{@onEdit}}
            @onFinishEditing={{@onFinishEditing}}
            @isTopCard={{true}}
            @moreOptionsMenuItems={{@contextMenuItems}}
          />
          <Preview class='preview' @card={{@card}} @format={{@format}} />
        </CardContainer>
      {{else if (eq @format 'embedded')}}
        <CardContainer class='preview-container'>
          <Preview class='preview' @card={{@card}} @format={{@format}} />
        </CardContainer>
      {{else if (eq @format 'atom')}}
        <div class='atom-preview-container' data-test-atom-preview>Lorem ipsum
          dolor sit amet, consectetur adipiscing elit, sed do
          <Preview
            class='atom-preview'
            @card={{@card}}
            @format={{@format}}
            @displayContainer={{false}}
          />
          tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim
          veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex
          ea commodo consequat.</div>
      {{else if (eq @format 'fitted')}}
        <FittedFormatGallery @card={{@card}} @isDarkMode={{true}} />
      {{/if}}
    {{/if}}

    <style scoped>
      .preview-container {
        height: auto;
      }
      .full-height-preview {
        flex-grow: 1;
        display: grid;
        grid-auto-rows: max-content 1fr;
      }
      .preview-header {
        box-shadow: 0 1px 0 0 rgba(0 0 0 / 15%);
        z-index: 1;
      }
      .preview-header:not(.is-editing) {
        background-color: var(--boxel-100);
      }
      .field-preview-card {
        padding: var(--boxel-sp);
      }
      .preview {
        box-shadow: none;
        border-radius: 0;
      }
      .atom-preview-container {
        color: #c7c7c7;
        font: 500 var(--boxel-font-sm);
        line-height: 2.15;
        letter-spacing: 0.13px;
      }
      .atom-preview :deep(.atom-default-template) {
        color: var(--boxel-dark);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-4xs);
        background-color: var(--boxel-light);
        margin: 0 var(--boxel-sp-xxxs);
        font: 600 var(--boxel-font-xs);
        line-height: 1.27;
        letter-spacing: 0.17px;
      }
    </style>
  </template>;

interface PlaygroundContentSignature {
  Args: {
    codeRef: ResolvedCodeRef;
    moduleId: string;
    isFieldDef?: boolean;
  };
}
class PlaygroundPanelContent extends Component<PlaygroundContentSignature> {
  <template>
    <div class='playground-panel-content'>
      <div class='instance-chooser-container'>
        <InstanceSelectDropdown
          @query={{this.query}}
          @realms={{this.recentRealms}}
          @card={{this.card}}
          @onSelect={{this.onSelect}}
          @chooseCard={{perform this.chooseCard}}
          @createNew={{if this.canWriteRealm this.createNew}}
          @createNewIsRunning={{this.createNewIsRunning}}
        />
      </div>
      {{#let (if @isFieldDef this.field this.card) as |card|}}
        {{#if card}}
          <div class='preview-area'>
            <PlaygroundPreview
              @card={{card}}
              @format={{this.format}}
              @realmInfo={{this.realmInfo}}
              @contextMenuItems={{this.contextMenuItems}}
              @onEdit={{if this.canEditCard (fn this.setFormat 'edit')}}
              @onFinishEditing={{if
                (eq this.format 'edit')
                (fn this.setFormat this.defaultFormat)
              }}
              @isFieldDef={{@isFieldDef}}
            />
          </div>
          <FormatChooser
            class='format-chooser'
            @format={{this.format}}
            @setFormat={{this.setFormat}}
          />
        {{/if}}
      {{/let}}
    </div>

    <style scoped>
      .playground-panel-content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        min-height: 100%;
      }
      .instance-chooser-container {
        position: sticky;
        z-index: 1;
        top: 0;
        display: flex;
        justify-content: center;
      }
      .instance-chooser-container > :deep(.ember-basic-dropdown) {
        max-width: 100%;
      }
      .preview-area {
        flex-grow: 1;
        z-index: 0;
        display: flex;
        flex-direction: column;
      }
      .format-chooser {
        position: sticky;
        bottom: 0;
        margin-top: auto;

        --boxel-format-chooser-button-bg-color: var(--boxel-light);
        --boxel-format-chooser-button-width: 80px;
        --boxel-format-chooser-button-min-width: 80px;
      }
    </style>
  </template>

  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service declare recentFilesService: RecentFilesService;
  @tracked newCardJSON: LooseSingleCardDocument | undefined;
  private playgroundSelections: Record<
    string, // moduleId
    { cardId: string; format: Format; fieldIndex: number | undefined }
  >; // TrackedObject

  constructor(owner: Owner, args: PlaygroundContentSignature['Args']) {
    super(owner, args);
    let selections = window.localStorage.getItem(PlaygroundSelections);

    this.playgroundSelections = new TrackedObject(
      selections?.length ? JSON.parse(selections) : {},
    );
  }

  get recentCardIds() {
    return this.recentFilesService.recentFiles
      .map((f) => `${f.realmURL}${f.filePath}`)
      .filter((id) => id.endsWith('.json'))
      .map((id) => id.slice(0, -1 * '.json'.length));
  }

  get recentRealms() {
    return [
      ...new Set(
        this.recentFilesService.recentFiles.map((f) => f.realmURL.href),
      ),
    ];
  }

  get query(): Query {
    if (this.args.isFieldDef) {
      // For fields, we're querying the Boxel Spec instances in recent realms, regardless of recent cards...
      return {
        filter: {
          on: specRef,
          eq: {
            ref: this.args.codeRef,
          },
        },
        sort: [
          {
            by: 'createdAt',
            direction: 'desc',
          },
        ],
      };
    }

    return {
      filter: {
        every: [
          {
            type: this.args.codeRef,
          },
          {
            any: this.recentCardIds.map((id) => ({ eq: { id } })).slice(0, 20),
          },
        ],
      },
      sort: [
        {
          by: 'createdAt',
          direction: 'desc',
        },
      ],
    };
  }

  private cardResource = getCard(
    this,
    () =>
      this.newCardJSON ?? this.playgroundSelections[this.args.moduleId]?.cardId,
    { isAutoSave: () => true },
  );

  private selectedDeclarationHasChanged = (card: CardDef) => {
    let cardRef = identifyCard(card.constructor) as ResolvedCodeRef | undefined;
    let { name } = this.args.codeRef;
    if (!cardRef) {
      return true;
    }
    if (this.args.isFieldDef) {
      if (!isSpec(card, cardRef)) {
        return true;
      }
      return card.ref.name !== name;
    } else {
      return cardRef.name !== name;
    }
  }

  private get card(): CardDef | undefined {
    let card = this.cardResource.card;
    if (card && this.selectedDeclarationHasChanged(card)) {
      return undefined;
    }
    return card;
  }

  private get defaultFormat() {
    return this.args.isFieldDef ? 'embedded' : 'isolated';
  }

  private get format(): Format {
    return (
      this.playgroundSelections[this.args.moduleId]?.format ??
      this.defaultFormat
    );
  }

  private get fieldIndex(): number | undefined {
    if (this.playgroundSelections[this.args.moduleId]?.fieldIndex) {
      return this.playgroundSelections[this.args.moduleId].fieldIndex;
    }
    return this.args.isFieldDef ? 0 : undefined;
  }

  private get field(): FieldDef | undefined {
    if (!this.args.isFieldDef) {
      return undefined;
    }
    let fieldInstances = (this.card as Spec)?.containedExamples;
    if (!fieldInstances?.length) {
      // TODO: handle case when spec has no instances
      return undefined;
    }
    let index = this.fieldIndex ?? 0;
    if (index >= fieldInstances.length) {
      // display the next available instance if item was deleted
      index = fieldInstances.length - 1;

      // update the index in local storage
      if (this.playgroundSelections[this.args.moduleId]) {
        this.playgroundSelections[this.args.moduleId].fieldIndex = index;
        this.persistSelections();
      }
    }
    return fieldInstances[index];
  }

  private copyToClipboard = task(async (id: string) => {
    await navigator.clipboard.writeText(id);
  });

  private openInInteractMode = task(async (id: string) => {
    await this.operatorModeStateService.openCardInInteractMode(
      new URL(id),
      this.format === 'edit' ? 'edit' : 'isolated',
    );
  });

  private get contextMenuItems() {
    if (!this.card?.id) {
      return undefined;
    }
    let cardId = this.card.id;
    let menuItems: MenuItem[] = [
      new MenuItem('Copy Card URL', 'action', {
        action: () => this.copyToClipboard.perform(cardId),
        icon: IconLink,
      }),
      new MenuItem('Open in Code Mode', 'action', {
        action: () =>
          this.operatorModeStateService.updateCodePath(new URL(cardId)),
        icon: IconCode,
      }),
      new MenuItem('Open in Interact Mode', 'action', {
        action: () => this.openInInteractMode.perform(cardId),
        icon: Eye,
      }),
    ];
    return menuItems;
  }

  private updatePlaygroundSelections = (
    selectedCardId: string,
    selectedFormat = this.format,
    selectedFieldIndex = this.fieldIndex,
  ) => {
    if (this.newCardJSON) {
      this.newCardJSON = undefined;
    }
    if (this.playgroundSelections[this.args.moduleId]) {
      let { cardId, format, fieldIndex } = this.playgroundSelections[this.args.moduleId];
      if (cardId && cardId === selectedCardId && format === selectedFormat && fieldIndex === selectedFieldIndex) {
        return;
      }
    }
    this.playgroundSelections[this.args.moduleId] = {
      cardId: selectedCardId,
      format: selectedFormat,
      fieldIndex: selectedFieldIndex,
    };
    this.persistSelections();
  }

  private persistSelections = () => {
    window.localStorage.setItem(
      PlaygroundSelections,
      JSON.stringify(this.playgroundSelections),
    );
  };

  @action private onSelect(card: PrerenderedCard) {
    this.updatePlaygroundSelections(card.url.replace(/\.json$/, ''));
  }

  @action
  private setFormat(format: Format) {
    if (!this.card?.id) {
      return;
    }
    this.updatePlaygroundSelections(this.card.id, format);
  }

  private chooseCard = task(async () => {
    let filter: Query['filter'] = this.args.isFieldDef
      ? { on: specRef, eq: { ref: this.args.codeRef } }
      : { type: this.args.codeRef };
    let chosenCard: CardDef | undefined = await chooseCard({ filter });

    if (chosenCard) {
      this.recentFilesService.addRecentFileUrl(`${chosenCard.id}.json`);
      this.updatePlaygroundSelections(chosenCard.id);
    }
  });

  @action private createNew() {
    this.args.isFieldDef ? this.createNewField.perform() : this.createNewCard.perform();
  }

  private get createNewIsRunning() {
    return this.createNewCard.isRunning || this.createNewField.isRunning;
  }

  // TODO: convert this to @action once we no longer need to await below
  private createNewCard = task(async () => {
    this.newCardJSON = {
      data: {
        meta: {
          adoptsFrom: this.args.codeRef,
          realmURL: this.operatorModeStateService.realmURL.href,
        },
      },
    };
    await this.cardResource.loaded; // TODO: remove await when card-resource is refactored
    if (this.card) {
      this.recentFilesService.addRecentFileUrl(`${this.card.id}.json`);
      this.updatePlaygroundSelections(this.card.id, 'edit'); // open new instance in playground in edit format
    }
  });

  // TODO: convert this to @action once we no longer need to await below
  private createNewField = task(async () => {
    let specCard = this.card as Spec | undefined;
    if (!specCard) {
      this.newCardJSON = {
        data: {
          attributes: {
            specType: 'field',
            ref: this.args.codeRef,
          },
          meta: {
            adoptsFrom: specRef,
            realmURL: this.operatorModeStateService.realmURL.href,
          },
        },
      };
      await this.cardResource.loaded; // TODO: remove await when card-resource is refactored
      if (this.card) {
        this.recentFilesService.addRecentFileUrl(`${this.card.id}.json`);
      }
    }
    if (this.card) {
      let fieldCard = await loadCard(this.args.codeRef, {  loader: this.loaderService.loader });
      let examples = (this.card as Spec).containedExamples;
      examples?.push(new fieldCard());
      let index = examples?.length ? examples.length - 1 : 0;
      this.updatePlaygroundSelections(this.card.id, 'edit', index);
      (document.querySelector('[data-playground-instance-chooser][aria-expanded="true"]') as BoxelSelect | null)?.click(); // close instance chooser dropdown menu if open
    }
  });

  private get realmInfo() {
    if (!this.card?.id) {
      return undefined;
    }
    return this.realm.info(this.card.id);
  }

  private get canEditCard() {
    return Boolean(
      this.format !== 'edit' &&
        this.card?.id &&
        this.realm.canWrite(this.card.id),
    );
  }

  private get canWriteRealm() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL.href);
  }
}

interface Signature {
  Args: {
    codeRef: ResolvedCodeRef;
    isLoadingNewModule?: boolean;
    isFieldDef?: boolean;
  };
  Element: HTMLElement;
}
export default class PlaygroundPanel extends Component<Signature> {
  <template>
    <section class='playground-panel' data-test-playground-panel>
      {{#if @isLoadingNewModule}}
        <LoadingIndicator @color='var(--boxel-light)' />
      {{else}}
        <PlaygroundPanelContent
          @codeRef={{@codeRef}}
          @moduleId={{this.moduleId}}
          @isFieldDef={{@isFieldDef}}
        />
      {{/if}}
    </section>
    <style scoped>
      .playground-panel {
        position: relative;
        background-image: url('./playground-background.png');
        background-position: left top;
        background-repeat: repeat;
        background-size: 22.5px;
        height: 100%;
        width: 100%;
        padding: var(--boxel-sp);
        background-color: var(--boxel-dark);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        overflow: auto;
      }
    </style>
  </template>

  get moduleId() {
    return internalKeyFor(this.args.codeRef, undefined);
  }
}
