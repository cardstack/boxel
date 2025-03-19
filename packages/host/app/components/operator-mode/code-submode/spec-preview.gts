import { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import AppsIcon from '@cardstack/boxel-icons/apps';
import Brain from '@cardstack/boxel-icons/brain';
import DotIcon from '@cardstack/boxel-icons/dot';
import LayoutList from '@cardstack/boxel-icons/layout-list';
import StackIcon from '@cardstack/boxel-icons/stack';

import { task } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';
import window from 'ember-window-mock';

import {
  BoxelButton,
  Pill,
  BoxelSelect,
  RealmIcon,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

import {
  type ResolvedCodeRef,
  type Query,
  type LooseSingleCardDocument,
  type getCard,
  type getCards,
  GetCardContextName,
  GetCardsContextName,
  specRef,
  isCardDef,
  isFieldDef,
  internalKeyFor,
} from '@cardstack/runtime-common';

import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';

import PrerenderedCardSearch, {
  PrerenderedCard,
} from '@cardstack/host/components/prerendered-card-search';
import Preview from '@cardstack/host/components/preview';

import consumeContext from '@cardstack/host/modifiers/consume-context';
import {
  CardOrFieldDeclaration,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';

import type CardService from '@cardstack/host/services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import {
  CardContext,
  type CardDef,
  Format,
} from 'https://cardstack.com/base/card-api';
import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

import ElementTracker, {
  type RenderedCardForOverlayActions,
} from '../../../resources/element-tracker';
import Overlays from '../overlays';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    selectedDeclaration?: ModuleDeclaration;
    onPlaygroundAccordionToggle: () => void;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof SpecPreviewTitle,
        | 'showCreateSpecIntent'
        | 'createSpec'
        | 'isCreateSpecInstanceRunning'
        | 'spec'
        | 'numberOfInstances'
      >,
      (
        | WithBoundArgs<
            typeof SpecPreviewContent,
            | 'showCreateSpecIntent'
            | 'canWrite'
            | 'onSelectCard'
            | 'selectedId'
            | 'spec'
            | 'isLoading'
            | 'cards'
            | 'updatePlaygroundSelections'
          >
        | WithBoundArgs<typeof SpecPreviewLoading, never>
      ),
    ];
  };
}

interface TitleSignature {
  Args: {
    numberOfInstances: number;
    spec?: Spec;
    showCreateSpecIntent: boolean;
    createSpec: (event: MouseEvent) => void;
    isCreateSpecInstanceRunning: boolean;
  };
}

class SpecPreviewTitle extends GlimmerComponent<TitleSignature> {
  private get moreThanOneInstance() {
    return this.args.numberOfInstances > 1;
  }

  private get specType() {
    return this.args.spec?.specType as SpecType | undefined;
  }

  <template>
    Boxel Spec

    <span class='has-spec' data-test-has-spec>
      {{#if @showCreateSpecIntent}}
        <BoxelButton
          @kind='primary'
          @size='small'
          @loading={{@isCreateSpecInstanceRunning}}
          {{on 'click' @createSpec}}
          data-test-create-spec-button
        >
          Create
        </BoxelButton>
      {{else if this.moreThanOneInstance}}
        <div class='number-of-instance'>
          <DotIcon class='dot-icon' />
          <div class='number-of-instance-text'>
            {{@numberOfInstances}}
            instances
          </div>
        </div>
      {{else}}
        {{#if this.specType}}
          <SpecTag @specType={{this.specType}} />
        {{/if}}
      {{/if}}
    </span>

    <style scoped>
      .has-spec {
        margin-left: auto;
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .number-of-instance {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
      }
      .number-of-instance-text {
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xl);
      }
      .dot-icon {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
      }
    </style>
  </template>
}

interface DidInsertSignature {
  Args: { Named: { onDidInsert: () => void } };
}

class DidInsert extends Modifier<DidInsertSignature> {
  modify(
    _element: HTMLElement,
    _positional: [],
    { onDidInsert }: DidInsertSignature['Args']['Named'],
  ) {
    onDidInsert();
  }
}

interface ContentSignature {
  Element: HTMLDivElement;
  Args: {
    showCreateSpecIntent: boolean;
    canWrite: boolean;
    onSelectCard: (cardId: string) => void;
    selectedId: string;
    cards: PrerenderedCard[];
    spec: Spec | undefined;
    isLoading: boolean;
    updatePlaygroundSelections: (cardId: string) => void;
  };
}

type SpecPreviewCardContext = Omit<
  CardContext,
  'prerenderedCardSearchComponent'
>;

class SpecPreviewContent extends GlimmerComponent<ContentSignature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @consume(GetCardsContextName) private declare getCards: getCards;

  @service private declare realm: RealmService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  private cardTracker = new ElementTracker();

  private get onlyOneInstance() {
    return this.args.cards.length === 1;
  }

  private get shouldSelectFirstCard() {
    return this.args.cards.length > 0 && !this.args.spec;
  }

  private get cardIds() {
    return this.args.cards.map((card) => card.url);
  }

  private get cardContext(): SpecPreviewCardContext {
    return {
      getCard: this.getCard,
      getCards: this.getCards,
      cardComponentModifier: this.cardTracker.trackElement,
    };
  }

  private get renderedCardsForOverlayActions(): RenderedCardForOverlayActions[] {
    return this.cardTracker
      .filter([{ fieldType: 'linksToMany' }])
      .map((entry) => ({
        ...entry,
        overlayZIndexStyle: htmlSafe(`z-index: 1`),
      }));
  }

  @action initializeCardSelection() {
    if (this.shouldSelectFirstCard) {
      this.args.onSelectCard(this.cardIds[0]);
    }
  }

  private getDropdownData = (id: string) => {
    let realmInfo = this.realm.info(id);
    let realmURL = this.realm.realmOfURL(new URL(id));
    if (!realmURL) {
      throw new Error('bug: no realm URL');
    }
    return {
      id: id,
      realmInfo,
      localPath: getRelativePath(realmURL.href, id),
    };
  };

  private get displayIsolated() {
    return !this.args.canWrite && this.args.cards.length > 0;
  }

  private get displayCannotWrite() {
    return !this.args.canWrite && this.args.cards.length === 0;
  }

  @action private viewSpecInstance() {
    if (!this.args.selectedId) {
      return;
    }

    const selectedUrl = new URL(this.args.selectedId);
    this.operatorModeStateService.updateCodePath(selectedUrl);
  }

  @action viewCardInPlayground(card: CardDef | string) {
    const cardId = typeof card === 'string' ? card : card.id;
    this.args.updatePlaygroundSelections(cardId);
  }

  <template>
    <div
      {{DidInsert onDidInsert=this.initializeCardSelection}}
      class={{cn
        'container'
        spec-intent-message=@showCreateSpecIntent
        cannot-write=this.displayCannotWrite
      }}
    >
      {{#if @showCreateSpecIntent}}
        <div data-test-create-spec-intent-message>
          Create a Boxel Specification to be able to create new instances
        </div>
      {{else if this.displayCannotWrite}}
        <div data-test-cannot-write-intent-message>
          Cannot create new Boxel Specification inside this realm
        </div>

      {{else}}

        {{#if @spec}}
          <div class='spec-preview'>
            <div class='spec-selector-container'>
              <div class='spec-selector' data-test-spec-selector>
                <BoxelSelect
                  @options={{this.cardIds}}
                  @selected={{@selectedId}}
                  @onChange={{@onSelectCard}}
                  @matchTriggerWidth={{true}}
                  @disabled={{this.onlyOneInstance}}
                  as |id|
                >
                  {{#if id}}
                    {{#let (this.getDropdownData id) as |data|}}
                      {{#if data}}
                        <div class='spec-selector-item'>
                          <RealmIcon
                            @canAnimate={{true}}
                            class='url-realm-icon'
                            @realmInfo={{data.realmInfo}}
                          />
                          <span data-test-spec-selector-item-path>
                            {{data.localPath}}
                          </span>
                        </div>
                      {{/if}}
                    {{/let}}
                  {{/if}}
                </BoxelSelect>
              </div>
              <BoxelButton
                @kind='secondary-light'
                @size='small'
                {{on 'click' this.viewSpecInstance}}
                data-test-view-spec-instance
              >
                <span class='view-instance-btn-text'>View Instance</span>
              </BoxelButton>
            </div>
            <Overlays
              @overlayClassName='spec-preview-overlay'
              @renderedCardsForOverlayActions={{this.renderedCardsForOverlayActions}}
              @onSelectCard={{this.viewCardInPlayground}}
            />
            {{#if this.displayIsolated}}
              <Preview
                @card={{@spec}}
                @format='isolated'
                @cardContext={{this.cardContext}}
              />
            {{else}}
              <Preview
                @card={{@spec}}
                @format='edit'
                @cardContext={{this.cardContext}}
              />
            {{/if}}
          </div>
        {{/if}}
      {{/if}}
    </div>

    <style scoped>
      .container {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        height: auto;
        width: 100%;
      }
      .spec-preview {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        width: 100%;
        padding: var(--boxel-sp-sm);
      }
      .spec-intent-message,
      .cannot-write {
        background-color: var(--boxel-200);
        color: var(--boxel-450);
        font-weight: 500;
        height: 100%;
        width: 100%;
        align-content: center;
        text-align: center;
      }
      .spec-preview-overlay {
        pointer-events: none;
        border-radius: var(--boxel-border-radius);
        box-shadow: 0 0 0 1px var(--boxel-dark);
      }
      .spec-selector-container {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .spec-selector {
        min-width: 50%;
        align-self: flex-start;
      }
      .spec-selector-item {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .view-instance-btn-text {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        word-break: break-word;
      }
    </style>
  </template>
}

interface SpecPreviewLoadingSignature {
  Element: HTMLDivElement;
}

const SpecPreviewLoading: TemplateOnlyComponent<SpecPreviewLoadingSignature> =
  <template>
    <div class='container'>
      <div class='loading'>
        <LoadingIndicator class='loading-icon' />
        Loading...
      </div>
    </div>
    <style scoped>
      .container {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }
      .loading {
        display: inline-flex;
      }
      .loading-icon {
        display: inline-block;
        margin-right: var(--boxel-sp-xxxs);
        vertical-align: middle;
      }
    </style>
  </template>;

export default class SpecPreview extends GlimmerComponent<Signature> {
  @consume(GetCardContextName) private declare getCard: getCard;

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare environmentService: EnvironmentService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service private declare cardService: CardService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @service private declare recentFilesService: RecentFilesService;
  @tracked private _selectedCardId?: string;
  @tracked private newCardJSON: LooseSingleCardDocument | undefined;
  @tracked private cardResource: ReturnType<getCard> | undefined;

  private makeCardResource = () => {
    this.cardResource = this.getCard(
      this,
      () => this.newCardJSON ?? this._selectedCardId,
      {
        isAutoSaved: true,
      },
    );
  };

  private get getSelectedDeclarationAsCodeRef(): ResolvedCodeRef {
    if (!this.args.selectedDeclaration?.exportName) {
      return {
        name: '',
        module: '',
      };
    }
    return {
      name: this.args.selectedDeclaration.exportName,
      module: `${this.operatorModeStateService.state.codePath!.href.replace(
        /\.[^.]+$/,
        '',
      )}`,
    };
  }

  private createSpecInstance = task(
    async (ref: ResolvedCodeRef, specType: SpecType) => {
      let relativeTo = new URL(ref.module);
      let maybeRef = codeRefWithAbsoluteURL(ref, relativeTo);
      let realmURL = this.operatorModeStateService.realmURL;
      if (isResolvedCodeRef(maybeRef)) {
        ref = maybeRef;
      }
      this.newCardJSON = {
        data: {
          attributes: {
            specType,
            ref,
            title: ref.name,
          },
          meta: {
            adoptsFrom: specRef,
            realmURL: realmURL.href,
          },
        },
      };
      await this.cardResource?.loaded;
      if (this.card) {
        this._selectedCardId = this.card.id;
        this.updateFieldSpecForPlayground(this.card.id);
        this.newCardJSON = undefined;
      }
    },
  );

  get realms() {
    return this.realmServer.availableRealmURLs;
  }

  private get specQuery(): Query {
    return {
      filter: {
        on: specRef,
        eq: {
          ref: this.getSelectedDeclarationAsCodeRef, //ref is primitive
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

  //TODO: Improve identification of isApp and isSkill
  // isApp and isSkill are far from perfect functions
  //We have good primitives to identify card and field but not for app and skill
  //Here we are trying our best based upon schema analyses what is an app and a skill
  //We don't try to capture deep ancestry of app and skill
  private isApp(selectedDeclaration: CardOrFieldDeclaration) {
    if (selectedDeclaration.exportName === 'AppCard') {
      return true;
    }
    if (
      selectedDeclaration.super &&
      selectedDeclaration.super.type === 'external' &&
      selectedDeclaration.super.name === 'AppCard'
    ) {
      return true;
    }
    return false;
  }

  private async isSkill(selectedDeclaration: CardOrFieldDeclaration) {
    const skillCardCodeRef = {
      name: 'SkillCard',
      module: 'https://cardstack.com/base/skill-card',
    };
    const isInClassChain = await selectedDeclaration.cardType.isClassInChain(
      selectedDeclaration.cardOrField,
      skillCardCodeRef,
    );

    if (isInClassChain) {
      return true;
    }

    return false;
  }

  private async guessSpecType(
    selectedDeclaration: ModuleDeclaration,
  ): Promise<SpecType> {
    if (isCardOrFieldDeclaration(selectedDeclaration)) {
      if (isCardDef(selectedDeclaration.cardOrField)) {
        if (this.isApp(selectedDeclaration)) {
          return 'app';
        }
        if (await this.isSkill(selectedDeclaration)) {
          return 'skill';
        }
        return 'card';
      }
      if (isFieldDef(selectedDeclaration.cardOrField)) {
        return 'field';
      }
    }
    throw new Error('Unidentified spec');
  }

  @action private async createSpec(event: MouseEvent) {
    event.stopPropagation();
    if (!this.args.selectedDeclaration) {
      throw new Error('bug: no selected declaration');
    }
    if (!this.getSelectedDeclarationAsCodeRef) {
      throw new Error('bug: no code ref');
    }
    let specType = await this.guessSpecType(this.args.selectedDeclaration);
    this.createSpecInstance.perform(
      this.getSelectedDeclarationAsCodeRef,
      specType,
    );
  }

  @action private onSelectCard(cardId: string): void {
    this._selectedCardId = cardId;
    this.updateFieldSpecForPlayground(cardId);
  }

  private get canWrite() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL.href);
  }

  private get card() {
    return this.cardResource?.card as Spec | undefined;
  }

  private getSpecIntent = (cards: PrerenderedCard[]) => {
    return cards.length === 0 && this.canWrite;
  };

  /**
   * Updates playground selections in localStorage if needed
   * @param id The card ID to select
   * @param defaultFormat The display format to use
   * @param isFieldSpec Whether we're checking for a field spec (true) or card (false)
   * @param fieldIndex The index of the field to select
   */
  private updatePlaygroundSelection(
    id: string,
    defaultFormat: Format,
    isFieldSpec: boolean,
    fieldIndex?: number,
  ) {
    const declaration = this.args.selectedDeclaration;

    if (!declaration?.exportName || !isCardOrFieldDeclaration(declaration)) {
      return;
    }

    // Check if we have the right kind of definition (field or card)
    const hasExpectedDefType = isFieldSpec
      ? isFieldDef(declaration.cardOrField)
      : isCardDef(declaration.cardOrField);

    if (!hasExpectedDefType) {
      return;
    }

    const moduleId = internalKeyFor(
      this.getSelectedDeclarationAsCodeRef,
      undefined,
    );
    const cardId = id.replace(/\.json$/, '');

    const selections = window.localStorage.getItem(PlaygroundSelections);
    let existingFormat = defaultFormat;

    if (selections) {
      const selection = JSON.parse(selections)[moduleId];
      // If we already have selections for this module, preserve the format
      existingFormat = selection?.format || defaultFormat;

      if (selection?.cardId === cardId) {
        return;
      }
    }

    this.playgroundPanelService.persistSelections(
      moduleId,
      cardId,
      existingFormat,
      fieldIndex,
    );
  }

  // Updates playground selection when a field spec is selected
  private updateFieldSpecForPlayground = (id: string) => {
    this.updatePlaygroundSelection(id, 'embedded', true, 0);
  };

  // Action triggered when a linkedExample card is selected
  // Updates playground selection & adds to recent files
  // Toggles the playground accordion open
  private updatePlaygroundSelections = (id: string) => {
    const fileUrl = id.endsWith('.json') ? id : `${id}.json`;
    this.recentFilesService.addRecentFileUrl(fileUrl);
    this.updatePlaygroundSelection(id, 'isolated', false);
    this.args.onPlaygroundAccordionToggle();
  };

  <template>
    <div
      class='item hidden'
      {{consumeContext consume=this.makeCardResource}}
    ></div>
    <PrerenderedCardSearch
      @query={{this.specQuery}}
      @format='fitted'
      @realms={{this.realms}}
    >
      <:response as |cards|>
        {{#let (this.getSpecIntent cards) as |showCreateSpecIntent|}}
          {{yield
            (component
              SpecPreviewTitle
              showCreateSpecIntent=showCreateSpecIntent
              createSpec=this.createSpec
              isCreateSpecInstanceRunning=this.createSpecInstance.isRunning
              spec=this.card
              numberOfInstances=cards.length
            )
            (component
              SpecPreviewContent
              showCreateSpecIntent=showCreateSpecIntent
              canWrite=this.canWrite
              onSelectCard=this.onSelectCard
              selectedId=this._selectedCardId
              spec=this.card
              isLoading=false
              cards=cards
              updatePlaygroundSelections=this.updatePlaygroundSelections
            )
          }}
        {{/let}}
      </:response>
      <:loading>
        {{yield
          (component
            SpecPreviewTitle
            showCreateSpecIntent=false
            createSpec=this.createSpec
            isCreateSpecInstanceRunning=this.createSpecInstance.isRunning
            numberOfInstances=0
          )
          (component SpecPreviewLoading)
        }}
      </:loading>
    </PrerenderedCardSearch>
    <style scoped>
      .hidden {
        display: none;
      }
    </style>
  </template>
}

interface SpecTagSignature {
  Element: HTMLDivElement;
  Args: {
    specType: SpecType;
  };
}

export class SpecTag extends GlimmerComponent<SpecTagSignature> {
  get icon() {
    return getIcon(this.args.specType);
  }
  <template>
    {{#if this.icon}}
      <Pill class='spec-tag-pill' ...attributes>
        <:iconLeft>
          {{this.icon}}
        </:iconLeft>
        <:default>
          {{@specType}}
        </:default>
      </Pill>

    {{/if}}
    <style scoped>
      .spec-tag-pill {
        --pill-font: 500 var(--boxel-font-xs);
        --pill-background-color: var(--boxel-200);
        word-break: initial;
      }
    </style>
  </template>
}

function getIcon(specType: SpecType) {
  switch (specType) {
    case 'card':
      return StackIcon;
    case 'app':
      return AppsIcon;
    case 'field':
      return LayoutList;
    case 'skill':
      return Brain;
    default:
      return;
  }
}

function getRelativePath(baseUrl: string, targetUrl: string) {
  const basePath = new URL(baseUrl).pathname;
  const targetPath = new URL(targetUrl).pathname;
  return targetPath.replace(basePath, '') || '/';
}
