import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Folder from '@cardstack/boxel-icons/folder';
import { task } from 'ember-concurrency';
import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import {
  AddButton,
  LoadingIndicator,
  BoxelSelect,
  CardContainer,
  CardHeader,
} from '@cardstack/boxel-ui/components';
import { and, bool, eq, or, MenuItem } from '@cardstack/boxel-ui/helpers';
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
  internalKeyFor,
  loadCard,
  specRef,
  type Query,
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { getCard } from '@cardstack/host/resources/card-resource';

import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type { EnhancedRealmInfo } from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

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
import FieldPickerModal from '../field-picker-modal';

import FormatChooser from './format-chooser';

const getItemTitle = (item: CardDef) => {
  if (!item) {
    return;
  }
  return item.title ?? `Untitled ${cardTypeDisplayName(item)}`;
};

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
          data-test-field-preview-header
        />
        <CardContainer class='field-preview-card' data-test-field-preview-card>
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
          @chooseCard={{this.chooseInstance}}
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
            @formats={{if @isFieldDef this.fieldFormats}}
            @format={{this.format}}
            @setFormat={{this.setFormat}}
            data-test-playground-format-chooser
          />
        {{else if (and (bool this.card) this.canWriteRealm)}}
          <AddButton
            class='add-field-button'
            @variant='full-width'
            @iconWidth='12px'
            @iconHeight='12px'
            {{on 'click' this.createNew}}
            data-test-add-field-instance
          >
            Add Field
          </AddButton>
        {{/if}}
      {{/let}}
    </div>

    {{#if this.fieldChooserIsOpen}}
      <ToElsewhere
        @named='playground-field-picker'
        @send={{component
          FieldPickerModal
          instances=this.fieldInstances
          selectedIndex=this.fieldIndex
          onSelect=this.chooseField
          onClose=this.closeFieldChooser
          name=(if this.field (cardTypeDisplayName this.field))
        }}
      />
    {{/if}}

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
        --boxel-format-chooser-button-width: 85px;
        --boxel-format-chooser-button-min-width: 85px;
      }
      .add-field-button {
        max-width: 500px;
        margin-inline: auto;
      }
    </style>
  </template>

  fieldFormats: Format[] = ['embedded', 'fitted', 'atom', 'edit'];
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service private declare recentFilesService: RecentFilesService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @tracked newCardJSON: LooseSingleCardDocument | undefined;
  @tracked fieldChooserIsOpen = false;

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
      // TODO
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

  private get playgroundSelection() {
    return this.playgroundPanelService.getSelection(this.args.moduleId);
  }

  private cardResource = getCard(
    this,
    () => this.newCardJSON ?? this.playgroundSelection?.cardId,
    { isAutoSave: () => true },
  );

  private get card(): CardDef | undefined {
    return this.cardResource.card;
  }

  private get defaultFormat() {
    return this.args.isFieldDef ? 'embedded' : 'isolated';
  }

  private get format(): Format {
    return (
      this.playgroundPanelService.getSelection(this.args.moduleId)?.format ??
      this.defaultFormat
    );
  }

  private get fieldIndex(): number | undefined {
    let index = this.playgroundPanelService.getSelection(
      this.args.moduleId,
    )?.fieldIndex;
    if (index !== undefined && index >= 0) {
      return index;
    }
    return this.args.isFieldDef ? 0 : undefined;
  }

  private get fieldInstances(): FieldDef[] | undefined {
    if (!this.args.isFieldDef) {
      return undefined;
    }
    let instances = (this.card as Spec)?.containedExamples;
    if (!instances?.length) {
      return undefined;
    }
    return instances;
  }

  private get field(): FieldDef | undefined {
    if (!this.args.isFieldDef || !this.card) {
      return undefined;
    }

    let fieldInstances = (this.card as Spec).containedExamples;
    if (!fieldInstances?.length) {
      return undefined;
    }

    let index = this.fieldIndex!;
    if (index >= fieldInstances.length) {
      // display the next available instance if item was deleted
      index = fieldInstances.length - 1;
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

  private persistSelections = (
    selectedCardId: string,
    selectedFormat = this.format,
    index = this.fieldIndex,
  ) => {
    if (this.newCardJSON) {
      this.newCardJSON = undefined;
    }
    let selection = this.playgroundPanelService.getSelection(
      this.args.moduleId,
    );
    if (selection?.cardId) {
      let { cardId, format, fieldIndex } = selection;
      if (
        cardId === selectedCardId &&
        format === selectedFormat &&
        fieldIndex === index
      ) {
        return;
      }
    }
    this.playgroundPanelService.persistSelections(
      this.args.moduleId,
      selectedCardId,
      selectedFormat,
      index,
    );
  };

  @action private onSelect(card: PrerenderedCard) {
    this.persistSelections(card.url.replace(/\.json$/, ''));
  }

  @action
  private setFormat(format: Format) {
    if (!this.card?.id) {
      return;
    }
    this.persistSelections(this.card.id, format);
  }

  // only closes the dropdown if it's open
  private closeInstanceChooser = () =>
    (
      document.querySelector(
        '[data-playground-instance-chooser][aria-expanded="true"]',
      ) as BoxelSelect | null
    )?.click();

  @action private chooseInstance() {
    this.args.isFieldDef
      ? (this.fieldChooserIsOpen = true)
      : this.chooseCard.perform();
    this.closeInstanceChooser();
  }

  @action private chooseField(index: number) {
    if (!this.card?.id) {
      return;
    }
    this.persistSelections(this.card.id, this.format, index);
    this.closeFieldChooser();
  }

  @action private closeFieldChooser() {
    this.fieldChooserIsOpen = false;
  }

  private chooseCard = task(async () => {
    let chosenCard: CardDef | undefined = await chooseCard({
      filter: { type: this.args.codeRef },
    });

    if (chosenCard) {
      this.recentFilesService.addRecentFileUrl(`${chosenCard.id}.json`);
      this.persistSelections(chosenCard.id);
    }
  });

  @action private createNew() {
    this.args.isFieldDef
      ? this.createNewField.perform()
      : this.createNewCard.perform();
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
      this.persistSelections(this.card.id, 'edit'); // open new instance in playground in edit format
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
            title: this.args.codeRef.name,
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
      let fieldCard = await loadCard(this.args.codeRef, {
        loader: this.loaderService.loader,
      });
      let examples = (this.card as Spec).containedExamples;
      examples?.push(new fieldCard());
      let index = examples?.length ? examples.length - 1 : 0;
      this.persistSelections(this.card.id, 'edit', index);
      this.closeInstanceChooser();
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
    isUpdating?: boolean;
  };
  Element: HTMLElement;
}
export default class PlaygroundPanel extends Component<Signature> {
  <template>
    <section class='playground-panel' data-test-playground-panel>
      {{#if this.isLoading}}
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

  get isLoading() {
    // TODO: improve live updating UX for fields
    return (
      this.args.isLoadingNewModule ||
      (this.args.isFieldDef && this.args.isUpdating)
    );
  }
}
