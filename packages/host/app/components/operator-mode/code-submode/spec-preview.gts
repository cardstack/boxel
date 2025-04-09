import { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { next } from '@ember/runloop';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import GlimmerComponent from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';

import AppsIcon from '@cardstack/boxel-icons/apps';
import Brain from '@cardstack/boxel-icons/brain';
import DotIcon from '@cardstack/boxel-icons/dot';
import LayoutList from '@cardstack/boxel-icons/layout-list';
import StackIcon from '@cardstack/boxel-icons/stack';

import { task } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';
import { use, resource } from 'ember-resources';
import window from 'ember-window-mock';
import { TrackedObject } from 'tracked-built-ins';

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
  type getCard,
  type getCards,
  GetCardContextName,
  GetCardsContextName,
  specRef,
  isCardDef,
  isFieldDef,
  internalKeyFor,
  loadCard,
} from '@cardstack/runtime-common';
import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';

import Preview from '@cardstack/host/components/preview';
import consumeContext from '@cardstack/host/helpers/consume-context';
import {
  CardOrFieldDeclaration,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';

import type CardService from '@cardstack/host/services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';
import type SpecPanelService from '@cardstack/host/services/spec-panel-service';
import type StoreService from '@cardstack/host/services/store';

import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import { CardContext, type Format } from 'https://cardstack.com/base/card-api';
import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

import ElementTracker, {
  type RenderedCardForOverlayActions,
} from '../../../resources/element-tracker';
import Overlays from '../overlays';

import type { SelectedAccordionItem } from '../code-submode';
import type { CardDefOrId } from '../stack-item';
import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    selectedDeclaration?: ModuleDeclaration;
    isLoadingNewModule: boolean;
    toggleAccordionItem: (item: SelectedAccordionItem) => void;
    isPanelOpen: boolean;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof SpecPreviewTitle,
        | 'showCreateSpec'
        | 'createSpec'
        | 'isCreateSpecInstanceRunning'
        | 'spec'
        | 'numberOfInstances'
      >,
      (
        | WithBoundArgs<
            typeof SpecPreviewContent,
            | 'showCreateSpec'
            | 'canWrite'
            | 'onSelectCard'
            | 'spec'
            | 'isLoading'
            | 'cards'
            | 'viewCardInPlayground'
            | 'onSpecView'
          >
        | WithBoundArgs<typeof SpecPreviewLoading, never>
      ),
    ];
  };
}

interface TitleSignature {
  Args: {
    spec?: Spec;
    numberOfInstances?: number;
    showCreateSpec: boolean;
    createSpec: (event: MouseEvent) => void;
    isCreateSpecInstanceRunning: boolean;
  };
}

class SpecPreviewTitle extends GlimmerComponent<TitleSignature> {
  private get moreThanOneInstance() {
    return this.args.numberOfInstances && this.args.numberOfInstances > 1;
  }

  private get specType() {
    return this.args.spec?.specType as SpecType | undefined;
  }

  <template>
    Boxel Spec

    <span class='has-spec' data-test-has-spec>
      {{#if @showCreateSpec}}
        <BoxelButton
          class='create-spec-button'
          @kind='primary'
          @size='extra-small'
          @loading={{@isCreateSpecInstanceRunning}}
          {{on 'click' @createSpec}}
          data-test-create-spec-button
        >
          Create
        </BoxelButton>
      {{else if this.moreThanOneInstance}}
        <div
          data-test-number-of-instance={{@numberOfInstances}}
          class='number-of-instance'
        >
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
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .create-spec-button {
        --boxel-button-min-height: auto;
        --boxel-button-min-width: auto;
        font-weight: 500;
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
    showCreateSpec: boolean;
    canWrite: boolean;
    onSelectCard: (card: Spec) => void;
    cards: Spec[];
    spec: Spec | undefined;
    isLoading: boolean;
    viewCardInPlayground: (cardDefOrId: CardDefOrId) => void;
    onSpecView: (spec: Spec) => void;
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
  @service private declare specPanelService: SpecPanelService;
  @service private declare store: StoreService;

  private cardTracker = new ElementTracker();

  private get onlyOneInstance() {
    return this.args.cards.length === 1;
  }

  private get cardContext(): SpecPreviewCardContext {
    return {
      getCard: this.getCard,
      getCards: this.getCards,
      store: this.store,
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

  private get selectedId() {
    return this.args.spec?.id;
  }

  @action private viewSpecInstance() {
    if (!this.selectedId) {
      return;
    }

    const selectedUrl = new URL(this.selectedId);
    this.operatorModeStateService.updateCodePath(selectedUrl);
  }

  <template>
    <div
      class={{cn
        'container'
        spec-intent-message=@showCreateSpec
        cannot-write=this.displayCannotWrite
      }}
    >
      {{#if @showCreateSpec}}
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
                  @options={{@cards}}
                  @selected={{@spec}}
                  @onChange={{@onSelectCard}}
                  @matchTriggerWidth={{true}}
                  @disabled={{this.onlyOneInstance}}
                  as |card|
                >
                  {{#if card.id}}
                    {{#let (this.getDropdownData card.id) as |data|}}
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
              @onSelectCard={{@viewCardInPlayground}}
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
                {{SpecPreviewModifier spec=@spec onSpecView=@onSpecView}}
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
  @consume(GetCardsContextName) private declare getCards: getCards;

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare environmentService: EnvironmentService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service private declare cardService: CardService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @service private declare loaderService: LoaderService;
  @service private declare recentFilesService: RecentFilesService;
  @service private declare specPanelService: SpecPanelService;
  @service private declare store: StoreService;
  @tracked private search: ReturnType<getCards<Spec>> | undefined;

  // We need a way to shield ourselves from the fact that ultimately the
  // ModuleContentsResource's declarations are not strict equal after a loader reset,
  // but still structurally the same (like a strictEqual vs deepEqual). This value
  // ultimately is consumed by the search resource, and even though the value never
  // changes from a deepEqual perspective, because of reactivity the search thunk is
  // triggered because it is not equivalent in a strict equality sense. So we use a
  // simple resource to cache the string and reactivity is only triggered when the
  // export name changes as opposed to being triggered because of strict equality
  // change in the selectedDeclaration arg.
  @use private selectedDeclarationExportName = resource(() => {
    let exportName = new TrackedObject<{ value: string | undefined }>({
      value: undefined,
    });
    (async () => {
      await Promise.resolve(); // buffer 1 microtask to prevent re-render cycles
      if (this.args.selectedDeclaration?.exportName !== exportName.value) {
        exportName.value = this.args.selectedDeclaration?.exportName;
      }
    })();
    return exportName;
  });

  @cached
  private get selectedDeclarationAsCodeRef(): ResolvedCodeRef {
    if (!this.selectedDeclarationExportName.value) {
      return {
        name: '',
        module: '',
      };
    }
    return {
      name: this.selectedDeclarationExportName.value,
      module: `${this.operatorModeStateService.codePathString!.replace(
        /\.[^.]+$/,
        '',
      )}`,
    };
  }

  private createSpecInstance = task(
    async (ref: ResolvedCodeRef, specType: SpecType) => {
      let relativeTo = new URL(ref.module);
      let maybeAbsoluteRef = codeRefWithAbsoluteURL(ref, relativeTo);
      if (isResolvedCodeRef(maybeAbsoluteRef)) {
        ref = maybeAbsoluteRef;
      }
      try {
        let SpecKlass = await loadCard(specRef, {
          loader: this.loaderService.loader,
        });
        let card = new SpecKlass({
          specType,
          ref,
          title: ref.name,
        }) as CardDef;
        let currentRealm = this.operatorModeStateService.realmURL;
        await this.store.add(card, { realm: currentRealm.href });
        if (card.id) {
          this.specPanelService.setSelection(card.id);
          if (!this.args.isPanelOpen) {
            this.args.toggleAccordionItem('spec-preview');
          }
        }
      } catch (e: any) {
        console.log('Error saving', e);
      }
    },
  );

  @cached
  private get realms() {
    return this.realmServer.availableRealmURLs;
  }

  @cached
  private get specQuery(): Query {
    return {
      filter: {
        on: specRef,
        eq: {
          ref: this.selectedDeclarationAsCodeRef, //ref is primitive
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
    if (!this.selectedDeclarationAsCodeRef) {
      throw new Error('bug: no code ref');
    }
    let specType = await this.guessSpecType(this.args.selectedDeclaration);
    this.createSpecInstance.perform(
      this.selectedDeclarationAsCodeRef,
      specType,
    );
  }

  @action private onSelectCard(card: Spec): void {
    this.specPanelService.setSelection(card.id);
  }

  private get canWrite() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL.href);
  }

  private makeSearch = () => {
    this.search = this.getCards(
      this,
      () => this.specQuery,
      () => this.realms,
    ) as ReturnType<getCards<Spec>>;
  };

  get _selectedCard() {
    let selectedCardId = this.specPanelService.specSelection;
    if (selectedCardId) {
      return this.cards.find((card) => card.id === selectedCardId) as Spec;
    }
    return this.cards?.[0] as Spec;
  }

  get cards() {
    return this.search?.instances ?? [];
  }

  private get card() {
    if (this._selectedCard) {
      return this._selectedCard;
    }
    return this.cards?.[0] as Spec;
  }

  get showCreateSpec() {
    return (
      Boolean(this.args.selectedDeclaration?.exportName) &&
      !this.search?.isLoading &&
      this.cards.length === 0 &&
      this.canWrite
    );
  }

  get isLoading() {
    return this.args.isLoadingNewModule;
  }

  private updatePlaygroundSelections(id: string, fieldDefOnly = false) {
    const declaration = this.args.selectedDeclaration;

    if (!declaration?.exportName || !isCardOrFieldDeclaration(declaration)) {
      return;
    }

    const isField = isFieldDef(declaration.cardOrField);
    if (fieldDefOnly && !isField) {
      return;
    }

    const moduleId = internalKeyFor(
      this.selectedDeclarationAsCodeRef,
      undefined,
    );
    const cardId = id.replace(/\.json$/, '');

    const selections = window.localStorage.getItem(PlaygroundSelections);
    let existingFormat: Format = isField ? 'embedded' : 'isolated';

    if (selections) {
      const selection = JSON.parse(selections)[moduleId];
      if (selection?.cardId === cardId) {
        return;
      }
      // If we already have selections for this module, preserve the format
      if (selection?.format) {
        existingFormat = selection?.format;
      }
    }

    this.playgroundPanelService.persistSelections(
      moduleId,
      cardId,
      existingFormat,
      isField ? 0 : undefined,
    );
  }

  private onSpecView = (spec: Spec) => {
    if (!spec.isField) {
      return; // not a field spec
    }
    if (
      this.selectedDeclarationAsCodeRef.name !== spec.ref.name ||
      this.selectedDeclarationAsCodeRef.module !== spec.moduleHref // absolute url
    ) {
      return; // not the right field spec
    }
    this.updatePlaygroundSelections(spec.id, true);
  };

  private viewCardInPlayground = (card: CardDefOrId) => {
    let id = typeof card === 'string' ? card : card.id;
    const fileUrl = id.endsWith('.json') ? id : `${id}.json`;
    this.recentFilesService.addRecentFileUrl(fileUrl);
    this.updatePlaygroundSelections(id);
    this.args.toggleAccordionItem('playground');
  };

  <template>
    {{consumeContext this.makeSearch}}
    {{#if this.isLoading}}
      {{yield
        (component
          SpecPreviewTitle
          showCreateSpec=false
          createSpec=this.createSpec
          isCreateSpecInstanceRunning=this.createSpecInstance.isRunning
          spec=this.card
        )
        (component SpecPreviewLoading)
      }}
    {{else}}
      {{yield
        (component
          SpecPreviewTitle
          showCreateSpec=this.showCreateSpec
          createSpec=this.createSpec
          isCreateSpecInstanceRunning=this.createSpecInstance.isRunning
          spec=this.card
          numberOfInstances=this.cards.length
        )
        (component
          SpecPreviewContent
          showCreateSpec=this.showCreateSpec
          canWrite=this.canWrite
          onSelectCard=this.onSelectCard
          spec=this.card
          isLoading=false
          cards=this.cards
          onSpecView=this.onSpecView
          viewCardInPlayground=this.viewCardInPlayground
        )
      }}
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
      <Pill
        data-test-spec-tag={{@specType}}
        class='spec-tag-pill'
        ...attributes
      >
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

interface ModifierSignature {
  Args: {
    Named: {
      spec?: Spec;
      onSpecView?: (spec: Spec) => void;
    };
  };
}

export class SpecPreviewModifier extends Modifier<ModifierSignature> {
  @service private declare playgroundPanelService: PlaygroundPanelService;

  modify(
    _element: HTMLElement,
    _positional: [],
    { spec, onSpecView }: ModifierSignature['Args']['Named'],
  ) {
    if (!spec || !onSpecView) {
      throw new Error('bug: no spec or onSpecView hook');
    }
    next(() => {
      onSpecView(spec);
    });
  }
}
