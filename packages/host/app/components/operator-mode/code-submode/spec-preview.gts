import { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import GlimmerComponent from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import AppsIcon from '@cardstack/boxel-icons/apps';
import Brain from '@cardstack/boxel-icons/brain';
import DotIcon from '@cardstack/boxel-icons/dot';

import LayoutList from '@cardstack/boxel-icons/layout-list';
import StackIcon from '@cardstack/boxel-icons/stack';
import { task } from 'ember-concurrency';

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
import { getCard } from '@cardstack/host/resources/card-resource';

import {
  CardOrFieldDeclaration,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';

import CardService from '@cardstack/host/services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    selectedDeclaration?: ModuleDeclaration;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof SpecPreviewTitle,
        | 'showCreateSpecIntent'
        | 'createSpec'
        | 'isCreateSpecInstanceRunning'
        | 'specType'
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
          >
        | WithBoundArgs<typeof SpecPreviewLoading, never>
      ),
    ];
  };
}

interface TitleSignature {
  Args: {
    numberOfInstances: number;
    specType: SpecType;
    showCreateSpecIntent: boolean;
    createSpec: (event: MouseEvent) => void;
    isCreateSpecInstanceRunning: boolean;
  };
}

class SpecPreviewTitle extends GlimmerComponent<TitleSignature> {
  get moreThanOneInstance() {
    return this.args.numberOfInstances > 1;
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
        {{#if @specType}}
          <SpecTag @specType={{@specType}} />
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
  };
}

class SpecPreviewContent extends GlimmerComponent<ContentSignature> {
  @service private declare realm: RealmService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  constructor(owner: Owner, args: ContentSignature['Args']) {
    super(owner, args);
    this.initializeCardSelection();
  }

  get onlyOneInstance() {
    return this.args.cards.length === 1;
  }

  get shouldSelectFirstCard() {
    return this.args.cards.length > 0 && !this.args.spec;
  }

  get cardIds() {
    return this.args.cards.map((card) => card.url);
  }

  @action initializeCardSelection() {
    if (this.shouldSelectFirstCard) {
      this.args.onSelectCard(this.cardIds[0]);
    }
  }

  getDropdownData = (id: string) => {
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

  get displayIsolated() {
    return !this.args.canWrite && this.args.cards.length > 0;
  }

  get displayCannotWrite() {
    return !this.args.canWrite && this.args.cards.length === 0;
  }

  @action viewSpecInstance() {
    if (!this.args.selectedId) {
      return;
    }

    const selectedUrl = new URL(this.args.selectedId);
    this.operatorModeStateService.updateCodePath(selectedUrl);
  }

  <template>
    <div
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
                View Instance
              </BoxelButton>
            </div>
            {{#if this.displayIsolated}}
              <Preview @card={{@spec}} @format='isolated' />
            {{else}}
              <Preview @card={{@spec}} @format='edit' />
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
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare environmentService: EnvironmentService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service private declare cardService: CardService;
  @tracked private _selectedCardId?: string;
  @tracked private newCardJSON: LooseSingleCardDocument | undefined;

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
      await this.cardResource.loaded;
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
  isApp(selectedDeclaration: CardOrFieldDeclaration) {
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

  isSkill(selectedDeclaration: CardOrFieldDeclaration) {
    if (selectedDeclaration.exportName === 'SkillCard') {
      return true;
    }
    if (
      selectedDeclaration.super &&
      selectedDeclaration.super.type === 'external' &&
      selectedDeclaration.super.name === 'SkillCard' &&
      selectedDeclaration.super.module ===
        'https://cardstack.com/base/skill-card'
    ) {
      return true;
    }
    return false;
  }

  guessSpecType(selectedDeclaration: ModuleDeclaration): SpecType {
    if (isCardOrFieldDeclaration(selectedDeclaration)) {
      if (isCardDef(selectedDeclaration.cardOrField)) {
        if (this.isApp(selectedDeclaration)) {
          return 'app';
        }
        if (this.isSkill(selectedDeclaration)) {
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

  @action createSpec(event: MouseEvent) {
    event.stopPropagation();
    if (!this.args.selectedDeclaration) {
      throw new Error('bug: no selected declaration');
    }
    if (!this.getSelectedDeclarationAsCodeRef) {
      throw new Error('bug: no code ref');
    }
    let specType = this.guessSpecType(this.args.selectedDeclaration);
    this.createSpecInstance.perform(
      this.getSelectedDeclarationAsCodeRef,
      specType,
    );
  }

  @action onSelectCard(cardId: string): void {
    this._selectedCardId = cardId;
    this.updateFieldSpecForPlayground(cardId);
  }

  get canWrite() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL.href);
  }

  private cardResource = getCard(
    this,
    () => this.newCardJSON ?? this._selectedCardId,
    {
      isAutoSave: () => true,
    },
  );

  get card() {
    let card = this.cardResource.card as Spec | undefined;
    if (!card) {
      return undefined;
    }
    if (card && this.selectedDeclarationHasChanged(card)) {
      return undefined;
    }
    return card;
  }

  get specType() {
    return this.card?.specType as SpecType;
  }

  getSpecIntent = (cards: PrerenderedCard[]) => {
    return cards.length === 0 && this.canWrite;
  };

  private selectedDeclarationHasChanged = (card: Spec) => {
    let { name } = this.getSelectedDeclarationAsCodeRef;
    return card.ref.name !== name;
  };

  // When previewing a field spec, changing the spec in Spec panel should
  // change the selected spec in Playground panel
  private updateFieldSpecForPlayground = (id: string) => {
    if (
      !this.args.selectedDeclaration?.exportName ||
      this.guessSpecType(this.args.selectedDeclaration) !== 'field'
    ) {
      return;
    }
    let moduleId = internalKeyFor(
      this.getSelectedDeclarationAsCodeRef,
      undefined,
    );
    let selections = window.localStorage.getItem(PlaygroundSelections);
    let playgroundSelections = selections?.length ? JSON.parse(selections) : {};
    let item = playgroundSelections[moduleId];
    if (!item) {
      playgroundSelections[moduleId] = {
        cardId: id,
        format: 'embedded',
        fieldIndex: 0,
      };
    } else {
      if (item.cardId === id) {
        return;
      }
      item.cardId = id;
      item.format = 'embedded';
      item.fieldIndex = 0;
    }
    window.localStorage.setItem(
      PlaygroundSelections,
      JSON.stringify(playgroundSelections),
    );
  };

  <template>
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
              specType=this.specType
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
            specType=this.specType
            numberOfInstances=0
          )
          (component SpecPreviewLoading)
        }}
      </:loading>
    </PrerenderedCardSearch>
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
