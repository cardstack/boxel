import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import GlimmerComponent from '@glimmer/component';

import { consume, provide } from 'ember-provide-consume-context';
import { resource, use } from 'ember-resources';

import { TrackedObject } from 'tracked-built-ins';

import {
  BoxelButton,
  BoxelSelect,
  RealmIcon,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

import {
  type ResolvedCodeRef,
  type getCard,
  type getCards,
  type getCardCollection,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  realmURL as realmURLSymbol,
  localId,
  isLocalId,
  CardContextName,
  isSpecCard,
  loadCardDef,
} from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';
import type { ModuleDeclaration } from '@cardstack/host/resources/module-contents';

import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type { ModuleInspectorView } from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';
import type SpecPanelService from '@cardstack/host/services/spec-panel-service';
import type StoreService from '@cardstack/host/services/store';

import type { CardContext } from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';

import ElementTracker, {
  type RenderedCardForOverlayActions,
} from '../../../resources/element-tracker';
import Overlays from '../overlays';

import type { CardDefOrId } from '../stack-item';
import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    activeSpec: Spec | undefined;
    isPanelOpen: boolean;
    selectedDeclaration?: ModuleDeclaration;
    selectedDeclarationAsCodeRef: ResolvedCodeRef;
    showCreateSpec: boolean;
    specsForSelectedDefinition: Spec[];
    setActiveModuleInspectorPanel: (item: ModuleInspectorView) => void;
    updatePlaygroundSelections(id: string, fieldDefOnly?: boolean): void;
  };
  Blocks: {
    loading: [WithBoundArgs<typeof SpecPreviewLoading, never>];
    content: [
      WithBoundArgs<
        typeof SpecPreviewContent,
        | 'showCreateSpec'
        | 'errorMessage'
        | 'canWrite'
        | 'onSelectSpec'
        | 'activeSpec'
        | 'isLoading'
        | 'allSpecs'
        | 'viewSpecInPlayground'
      >,
    ];
  };
}

interface ContentSignature {
  Element: HTMLDivElement;
  Args: {
    showCreateSpec: boolean;
    errorMessage?: string;
    canWrite: boolean;
    onSelectSpec: (spec: Spec) => void;
    allSpecs: Spec[];
    activeSpec: Spec | undefined;
    isLoading: boolean;
    viewSpecInPlayground: (cardDefOrId: CardDefOrId) => void;
  };
}

type SpecPreviewCardContext = Omit<
  CardContext,
  'prerenderedCardSearchComponent'
>;

class SpecPreviewContent extends GlimmerComponent<ContentSignature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @consume(GetCardsContextName) private declare getCards: getCards;
  @consume(GetCardCollectionContextName)
  private declare getCardCollection: getCardCollection;
  @consume(CardContextName) private declare cardContext: CardContext;
  @service private declare realm: RealmService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare specPanelService: SpecPanelService;
  @service private declare store: StoreService;

  private cardTracker = new ElementTracker();

  private get onlyOneInstance() {
    return this.args.allSpecs.length === 1;
  }

  @provide(CardContextName)
  // @ts-ignore "context" is declared but not used
  private get context(): SpecPreviewCardContext {
    return {
      ...this.cardContext,
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

  private getDropdownData = (spec: Spec) => {
    let realmInfo = this.realm.info(urlForRealmLookup(spec));
    let realmURL = spec[realmURLSymbol];
    if (!realmURL) {
      throw new Error('bug: no realm URL');
    }
    return {
      id: spec.id,
      realmInfo,
      localPath: spec.id ? getRelativePath(realmURL.href, spec.id) : undefined,
    };
  };

  private get displayIsolated() {
    return !this.args.canWrite && this.args.allSpecs.length > 0;
  }

  private get displayCannotWrite() {
    return !this.args.canWrite && this.args.allSpecs.length === 0;
  }

  private get selectedId() {
    return this.args.activeSpec?.id ?? this.args.activeSpec?.[localId];
  }

  @action private async viewSpecInstance() {
    if (!this.selectedId || isLocalId(this.selectedId)) {
      return;
    }

    const selectedUrl = new URL(this.selectedId);
    await this.operatorModeStateService.updateCodePath(selectedUrl);
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
      {{else if @errorMessage}}
        <div data-test-spec-error-message>
          {{@errorMessage}}
        </div>
      {{else if this.displayCannotWrite}}
        <div data-test-cannot-write-intent-message>
          Cannot create new Boxel Specification inside this realm
        </div>

      {{else}}

        {{#if @activeSpec}}
          <div class='spec-preview'>

            <div class='spec-selector-container'>
              <div class='spec-selector' data-test-spec-selector>
                <BoxelSelect
                  @options={{@allSpecs}}
                  @selected={{@activeSpec}}
                  @onChange={{@onSelectSpec}}
                  @matchTriggerWidth={{true}}
                  @disabled={{this.onlyOneInstance}}
                  as |spec|
                >
                  {{#let (this.getDropdownData spec) as |data|}}
                    {{#if data}}
                      <div class='spec-selector-item'>
                        <RealmIcon
                          @canAnimate={{true}}
                          class='url-realm-icon'
                          @realmInfo={{data.realmInfo}}
                        />
                        {{#if spec.id}}
                          <span data-test-spec-selector-item-path>
                            {{data.localPath}}
                          </span>
                        {{/if}}
                      </div>
                    {{/if}}
                  {{/let}}
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
              @onSelectCard={{@viewSpecInPlayground}}
            />
            {{#if this.displayIsolated}}
              <CardRenderer @card={{@activeSpec}} @format='isolated' />
            {{else}}
              <CardRenderer @card={{@activeSpec}} @format='edit' />
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
    <div class='loading'>
      <LoadingIndicator />
    </div>
    <style scoped>
      .loading {
        display: flex;
        justify-content: center;
        margin: 30vh auto;
      }
    </style>
  </template>;

export default class SpecPreview extends GlimmerComponent<Signature> {
  @service private declare loaderService: LoaderService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare recentFilesService: RecentFilesService;
  @service private declare specPanelService: SpecPanelService;
  @service private declare store: StoreService;

  @use private selectedDeclarationSpecState = resource(() => {
    let state = new TrackedObject<{ value: boolean }>({ value: false });
    let codeRef = this.args.selectedDeclarationAsCodeRef;
    if (!codeRef.module || !codeRef.name) {
      return state;
    }
    (async () => {
      try {
        let cardDef = await loadCardDef(codeRef, {
          loader: this.loaderService.loader,
          relativeTo: new URL(this.operatorModeStateService.realmURL),
        });
        state.value = isSpecCard(cardDef);
      } catch {
        state.value = false;
      }
    })();
    return state;
  });

  @action private onSelectSpec(spec: Spec): void {
    this.specPanelService.setSelection(spec.id);
  }

  private get selectedDeclarationIsSpec() {
    return this.selectedDeclarationSpecState?.value ?? false;
  }

  private get canWrite() {
    return (
      this.realm.canWrite(this.operatorModeStateService.realmURL) &&
      !this.selectedDeclarationIsSpec
    );
  }

  private get displayCannotCreateSpecFromSpec() {
    return this.selectedDeclarationIsSpec;
  }

  private get errorMessage() {
    if (this.displayCannotCreateSpecFromSpec) {
      return 'Cannot display or create Boxel Specification for subclasses of spec';
    }
    return undefined;
  }

  get isLoading() {
    return false;
  }

  private viewSpecInPlayground = (spec: CardDefOrId) => {
    let id = typeof spec === 'string' ? spec : spec.id;
    const fileUrl = id.endsWith('.json') ? id : `${id}.json`;
    this.recentFilesService.addRecentFileUrl(fileUrl);
    this.args.updatePlaygroundSelections(id);
    this.args.setActiveModuleInspectorPanel('preview');
  };

  <template>
    {{#if this.isLoading}}
      {{yield (component SpecPreviewLoading) to='loading'}}
    {{else}}
      {{yield
        (component
          SpecPreviewContent
          showCreateSpec=@showCreateSpec
          errorMessage=this.errorMessage
          canWrite=this.canWrite
          onSelectSpec=this.onSelectSpec
          activeSpec=@activeSpec
          isLoading=false
          allSpecs=@specsForSelectedDefinition
          viewSpecInPlayground=this.viewSpecInPlayground
        )
        to='content'
      }}
    {{/if}}
  </template>
}

function getRelativePath(baseUrl: string, targetUrl: string) {
  const basePath = new URL(baseUrl).pathname;
  const targetPath = new URL(targetUrl).pathname;
  return targetPath.replace(basePath, '') || '/';
}
