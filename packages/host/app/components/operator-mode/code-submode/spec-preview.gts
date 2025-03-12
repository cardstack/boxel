import { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import AppsIcon from '@cardstack/boxel-icons/apps';
import Brain from '@cardstack/boxel-icons/brain';
import DotIcon from '@cardstack/boxel-icons/dot';
import LayoutList from '@cardstack/boxel-icons/layout-list';
import StackIcon from '@cardstack/boxel-icons/stack';

import { task } from 'ember-concurrency';
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
  specRef,
  isCardDef,
  isFieldDef,
  internalKeyFor,
} from '@cardstack/runtime-common';

import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';

import Preview from '@cardstack/host/components/preview';

import {
  CardOrFieldDeclaration,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';
import { getSearch } from '@cardstack/host/resources/search';

import type CardService from '@cardstack/host/services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    selectedDeclaration?: ModuleDeclaration;
    isLoadingNewModule?: boolean;
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
    cards: Spec[];
    spec: Spec | undefined;
    isLoading: boolean;
  };
}

class SpecPreviewContent extends GlimmerComponent<ContentSignature> {
  @service private declare realm: RealmService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  get onlyOneInstance() {
    return this.args.cards.length === 1;
  }

  get shouldSelectFirstCard() {
    return this.args.cards.length > 0 && !this.args.spec;
  }

  get cardIds() {
    return this.args.cards.map((card) => card.id);
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

  get selectedId() {
    return this.args.spec?.id;
  }

  @action viewSpecInstance() {
    if (!this.selectedId) {
      return;
    }

    const selectedUrl = new URL(this.selectedId);
    this.operatorModeStateService.updateCodePath(selectedUrl);
  }

  get hasCardId() {
    return this.args.spec && this.args.spec.id;
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

        <div class='spec-preview'>
          <div class='spec-selector-container'>
            <div class='spec-selector' data-test-spec-selector>
              <BoxelSelect
                @options={{this.cardIds}}
                @selected={{this.selectedId}}
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
          {{#if @spec}}
            {{#if this.displayIsolated}}
              <Preview @card={{@spec}} @format='isolated' />
            {{else}}
              <Preview @card={{@spec}} @format='edit' />
            {{/if}}
          {{/if}}
        </div>
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
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare environmentService: EnvironmentService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service private declare cardService: CardService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @tracked private _selectedCard?: Spec;

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
      let doc = {
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
      try {
        let card = await this.cardService.createFromSerialized(doc.data, doc);
        if (!card) {
          throw new Error(
            `Failed to create card from ref "${ref.name}" from "${ref.module}"`,
          );
        }
        await this.cardService.saveModel(card);
      } catch (e: any) {
        console.log('Error saving', e);
      }
      if (this.card) {
        this._selectedCard = this.cards.find(
          (card) => card.id === this.card.id,
        );
        this.updateFieldSpecForPlayground(this.card.id);
      }
    },
  );

  initializeFieldSpecForPlayground = () => {
    this.updateFieldSpecForPlayground(this.cards[0].id);
  };

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

  async isSkill(selectedDeclaration: CardOrFieldDeclaration) {
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

  async guessSpecType(
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

  @action async createSpec(event: MouseEvent) {
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

  @action onSelectCard(cardId: string): void {
    this._selectedCard = this.cards.find((card) => card.id === cardId);
    this.updateFieldSpecForPlayground(cardId);
  }

  get canWrite() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL.href);
  }

  search = getSearch(
    this,
    () => this.specQuery,
    () => this.realms,
    { isLive: true, isAutoSave: true },
  );

  get cards() {
    return this.search.instances as Spec[];
  }

  get shouldInitializeFieldSpecForPlayground() {
    return (
      !this.search.isLoading && !this._selectedCard && this.cards.length > 1
    );
  }

  get card() {
    if (this._selectedCard) {
      return this._selectedCard;
    }
    return this.cards?.[0] as Spec;
  }

  get specType() {
    return this.card?.specType as SpecType;
  }

  getSpecIntent = (cards: any[]) => {
    return cards.length === 0 && this.canWrite;
  };

  // When previewing a field spec, changing the spec in Spec panel should
  // change the selected spec in Playground panel
  private updateFieldSpecForPlayground = (id: string) => {
    let declaration = this.args.selectedDeclaration;
    if (
      !declaration?.exportName ||
      !isCardOrFieldDeclaration(declaration) ||
      !isFieldDef(declaration.cardOrField)
    ) {
      return;
    }
    let moduleId = internalKeyFor(
      this.getSelectedDeclarationAsCodeRef,
      undefined,
    );
    let cardId = id.replace(/\.json$/, '');
    let selections = window.localStorage.getItem(PlaygroundSelections);
    if (selections) {
      let selection = JSON.parse(selections)[moduleId];
      if (selection?.cardId === cardId) {
        return;
      }
    }
    this.playgroundPanelService.persistSelections(
      moduleId,
      cardId,
      'embedded',
      0,
    );
  };

  <template>
    {{#if @isLoadingNewModule}}
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
    {{else}}
      {{#if this.shouldInitializeFieldSpecForPlayground}}
        {{this.initializeFieldSpecForPlayground}}
      {{/if}}
      {{#let (this.getSpecIntent this.cards) as |showCreateSpecIntent|}}
        {{yield
          (component
            SpecPreviewTitle
            showCreateSpecIntent=showCreateSpecIntent
            createSpec=this.createSpec
            isCreateSpecInstanceRunning=this.createSpecInstance.isRunning
            specType=this.specType
            numberOfInstances=this.cards.length
          )
          (component
            SpecPreviewContent
            showCreateSpecIntent=showCreateSpecIntent
            canWrite=this.canWrite
            onSelectCard=this.onSelectCard
            spec=this.card
            isLoading=false
            cards=this.cards
          )
        }}
      {{/let}}

    {{/if}}
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
