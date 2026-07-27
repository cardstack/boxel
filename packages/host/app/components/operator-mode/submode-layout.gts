import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';
import { restartableTask, timeout } from 'ember-concurrency';

import { modifier } from 'ember-modifier';
import window from 'ember-window-mock';

import { TrackedObject } from 'tracked-built-ins';

import {
  Avatar,
  IconButton,
  ResizablePanelGroup,
} from '@cardstack/boxel-ui/components';
import { bool, cn, eq, not } from '@cardstack/boxel-ui/helpers';

import { BoxelIconWithText } from '@cardstack/boxel-ui/icons';

import { rri } from '@cardstack/runtime-common';
import type { ResolvedCodeRef } from '@cardstack/runtime-common';

import AiAssistantButton from '@cardstack/host/components/ai-assistant/button';
import AiAssistantPanel from '@cardstack/host/components/ai-assistant/panel';
import AiAssistantToast from '@cardstack/host/components/ai-assistant/toast';
import ProfileSettingsModal from '@cardstack/host/components/operator-mode/profile/profile-settings-modal';
import ProfileInfoPopover from '@cardstack/host/components/operator-mode/profile-info-popover';

import type IndexController from '@cardstack/host/controllers';

import { assertNever } from '@cardstack/host/utils/assert-never';
import { AiAssistantPanelWidth } from '@cardstack/host/utils/local-storage-keys';

import SearchSheet, { SearchSheetModes } from '../search-sheet';

import SubmodeSwitcher, { Submodes } from '../submode-switcher';

import ChooseSubscriptionPlanModal from './choose-subscription-plan-modal';

import NewFileButton, { type NewFileOptions } from './new-file-button';
import WorkspaceChooser from './workspace-chooser';

import type AiAssistantPanelService from '../../services/ai-assistant-panel-service';
import type MatrixService from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RecentCardsService from '../../services/recent-cards-service';
import type SearchSheetStateService from '../../services/search-sheet-state';
import type StoreService from '../../services/store';
import type { SearchSheetMode } from '../search-sheet';
import type { Submode } from '../submode-switcher';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onSearchSheetOpened?: () => void;
    onSearchSheetClosed?: () => void;
    onCardSelectFromSearch?: (cardId: string) => void;
    selectedCardRef?: ResolvedCodeRef | undefined;
    newFileOptions?: NewFileOptions;
  };
  Blocks: {
    default: [
      {
        openSearchToPrompt: () => void;
        openSearchToResults: (term: string, typeRef?: ResolvedCodeRef) => void;
        updateSubmode: (submode: Submode) => void;
      },
    ];
    topBar: [];
  };
}

let handleWindowResizeModifier = modifier(
  (element, [onWindowResize]: [(width: number) => void]) => {
    let updateWindowWidth = () => {
      let boundingClient = element.getBoundingClientRect();
      onWindowResize(boundingClient.width);
    };
    updateWindowWidth();
    window.addEventListener('resize', updateWindowWidth);

    return () => {
      window.removeEventListener('resize', updateWindowWidth);
    };
  },
);

let captureElement = modifier(
  (element, [onInsert]: [(element: Element) => void]) => {
    onInsert(element);
  },
);

type PanelWidths = {
  defaultWidth: number | null;
  minWidth: number | null;
};

const COLLAPSED_TOP_BAR_BUTTONS_WIDTH_REM = 46;
const COLLAPSED_TOP_BAR_BUTTONS_NOT_EXPANDED_WIDTH_REM = 23;

export default class SubmodeLayout extends Component<Signature> {
  @tracked private searchSheetMode: SearchSheetMode = SearchSheetModes.Closed;
  @tracked private profileSummaryOpened = false;
  @tracked private topBarCenterElement: Element | null = null;
  @tracked private currentWindowWidth = 0;

  private get topBarButtonsCollapsed(): boolean {
    let rootFontSize = Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    let threshold = this.operatorModeStateService.hasAnyStackItemExpanded
      ? COLLAPSED_TOP_BAR_BUTTONS_WIDTH_REM
      : COLLAPSED_TOP_BAR_BUTTONS_NOT_EXPANDED_WIDTH_REM;
    return this.currentWindowWidth <= threshold * rootFontSize;
  }

  private get submodeSwitcherCollapsed(): boolean {
    return (
      this.operatorModeStateService.hasAnyStackItemExpanded &&
      this.topBarButtonsCollapsed
    );
  }

  private aiPanelWidths: PanelWidths = new TrackedObject({
    defaultWidth: 30,
    minWidth: 25,
  });
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private recentCardsService: RecentCardsService;
  @service('search-sheet-state')
  declare private searchSheetState: SearchSheetStateService;

  private searchElement: HTMLElement | null = null;
  private suppressSearchClose = false;
  declare private doSearch: (term: string, typeRef?: ResolvedCodeRef) => void;

  @action
  private storeExpandedCardHeaderElement(element: Element) {
    this.operatorModeStateService.expandedCardHeaderElement =
      element as HTMLElement;
  }

  @action
  private storeTopBarCenterElement(element: Element) {
    this.topBarCenterElement = element;
  }

  @action
  private onLayoutChange(layout: number[]) {
    // layout is an array of two numbers,
    // the first number is the width of the main panel,
    // the second number is the width of the ai panel.
    if (layout.length === 2) {
      window.localStorage.setItem(AiAssistantPanelWidth, String(layout[1]));
    }
  }

  // Handles window resize and initializes AI panel width from localStorage
  onWindowResize = (windowWidth: number) => {
    this.currentWindowWidth = windowWidth;

    let aiPanelDefaultWidthInPixels = 371;
    if (windowWidth < aiPanelDefaultWidthInPixels) {
      aiPanelDefaultWidthInPixels = windowWidth;
    }
    let aiPanelDefaultWidth = (aiPanelDefaultWidthInPixels / windowWidth) * 100;
    const persistedWidth = window.localStorage.getItem(AiAssistantPanelWidth)
      ? Number(window.localStorage.getItem(AiAssistantPanelWidth))
      : undefined;

    if (!persistedWidth || persistedWidth < aiPanelDefaultWidth) {
      this.aiPanelWidths.defaultWidth = aiPanelDefaultWidth;
    } else {
      this.aiPanelWidths.defaultWidth = persistedWidth;
    }

    this.aiPanelWidths.minWidth = aiPanelDefaultWidth;
  };

  get operatorModeController(): IndexController {
    return this.operatorModeStateService.operatorModeController;
  }

  private get aiAssistantVisibilityClass() {
    return this.aiAssistantPanelService.isOpen
      ? 'ai-assistant-open'
      : 'ai-assistant-closed';
  }

  private get allStackItems() {
    return this.operatorModeStateService.state?.stacks.flat() ?? [];
  }

  private get lastStackItem() {
    if (this.allStackItems.length <= 0) {
      return null;
    }
    return this.allStackItems[this.allStackItems.length - 1];
  }

  private get lastCardIdInRightMostStack() {
    let stackItem = this.lastStackItem;
    if (!stackItem) {
      return null;
    }
    return this.store.peek(stackItem.id)?.id;
  }

  private get isToggleWorkspaceChooserDisabled() {
    return this.operatorModeStateService.state.stacks.length === 0;
  }

  @action private async updateSubmode(submode: Submode) {
    switch (submode) {
      case Submodes.Interact:
        await this.operatorModeStateService.updateCodePath(null);
        break;
      case Submodes.Code: {
        let lastId = this.lastCardIdInRightMostStack;
        let codePath = lastId
          ? rri(this.lastStackItem?.type === 'file' ? lastId : lastId + '.json')
          : null;
        await this.operatorModeStateService.updateCodePath(codePath);
        break;
      }
      case Submodes.Host: {
        let currentSubmode = this.operatorModeStateService.state.submode;

        if (currentSubmode === Submodes.Code) {
          // Check if current code path is a card instance ID
          let codePathString = this.operatorModeStateService.codePathString;
          if (codePathString) {
            let cardId = codePathString.replace(/\.json$/, '');
            let card = this.store.peek(cardId);

            if (card && this.isCardInstance(card)) {
              // Current code path is a card instance, use it directly
              this.operatorModeStateService.setHostModePrimaryCard(
                codePathString,
              );
            } else {
              // Current code path is a card definition, try to get card ID from playground panel
              let playgroundSelection =
                this.operatorModeStateService.playgroundPanelSelection;
              if (playgroundSelection?.cardId) {
                this.operatorModeStateService.setHostModePrimaryCard(
                  playgroundSelection.cardId + '.json',
                );
              } else {
                // Try to find any card instance related to this definition
                let relatedCardId =
                  await this.findRelatedCardInstance(codePathString);
                if (relatedCardId) {
                  this.operatorModeStateService.setHostModePrimaryCard(
                    relatedCardId + '.json',
                  );
                } else {
                  this.operatorModeStateService.setHostModePrimaryCard();
                }
              }
            }
          } else {
            this.operatorModeStateService.setHostModePrimaryCard();
          }
        } else if (currentSubmode === Submodes.Interact) {
          this.operatorModeStateService.setHostModePrimaryCard(
            this.lastCardIdInRightMostStack
              ? this.lastCardIdInRightMostStack + '.json'
              : undefined,
          );
        }

        break;
      }
      default:
        throw assertNever(submode);
    }

    this.operatorModeStateService.updateSubmode(submode);
  }

  private isCardInstance(card: any): boolean {
    return card && typeof card === 'object' && 'id' in card && card.id;
  }

  private async findRelatedCardInstance(
    definitionPath: string,
  ): Promise<string | null> {
    try {
      // Try to find any card instance that adopts from this definition
      // This is a simplified approach - in a real implementation you might want to
      // search through recent cards or use a more sophisticated lookup
      let recentCards = this.recentCardsService.recentCards;

      for (let recentCard of recentCards) {
        let card = this.store.peek(recentCard.cardId);
        if (card && this.isCardInstance(card)) {
          // Check if this card adopts from the definition we're looking at
          // This is a simplified check - you might need more sophisticated logic
          let definitionName = definitionPath
            .split('/')
            .pop()
            ?.replace('.json', '');
          if (
            definitionName &&
            card.constructor.name === definitionName &&
            card.id
          ) {
            return card.id;
          }
        }
      }

      return null;
    } catch (error) {
      console.warn('Error finding related card instance:', error);
      return null;
    }
  }

  @action private closeSearchSheet() {
    if (this.suppressSearchClose) {
      return;
    }
    this.searchSheetMode = SearchSheetModes.Closed;
    this.args.onSearchSheetClosed?.();
  }

  @action private expandSearchToShowResults(_term: string) {
    this.searchSheetMode = SearchSheetModes.SearchResults;
  }

  @action private expandSearchOnFilterChange() {
    if (this.searchSheetMode === SearchSheetModes.SearchPrompt) {
      this.searchSheetMode = SearchSheetModes.SearchResults;
    }
  }

  @action private openSearchSheetToPrompt() {
    if (this.searchSheetMode === SearchSheetModes.Closed) {
      // Reopen straight to the results view when a search is persisted, so the
      // restored results are shown immediately rather than the compact prompt.
      // Gate on the service's own `hasActiveSearch` (term OR type OR realm) —
      // the same predicate that produces `mainQuery` — so a filter-only search
      // (e.g. code mode's "Find instances", which sets a type with no term)
      // reopens to its live results rather than the recents-only compact prompt.
      this.searchSheetMode = this.searchSheetState.hasActiveSearch
        ? SearchSheetModes.SearchResults
        : SearchSheetModes.SearchPrompt;
    }

    this.searchElement?.focus();
    this.args.onSearchSheetOpened?.();
  }

  @action private async handleCardSelectFromSearch(cardId: string) {
    this.args.onCardSelectFromSearch?.(cardId);
    this.closeSearchSheet();
  }

  private get workspaceChooserOpened() {
    return this.operatorModeStateService.workspaceChooserOpened;
  }

  private set workspaceChooserOpened(workspaceChooserOpened: boolean) {
    this.operatorModeStateService.workspaceChooserOpened =
      workspaceChooserOpened;
  }

  @action private toggleWorkspaceChooser() {
    this.operatorModeStateService.workspaceChooserOpened =
      !this.operatorModeStateService.workspaceChooserOpened;
  }

  @action private toggleProfileSettings() {
    this.operatorModeStateService.toggleProfileSettings();

    this.profileSummaryOpened = false;
  }

  @action private toggleSubscriptionPlans() {
    this.isChooseSubscriptionPlanModalOpen =
      !this.isChooseSubscriptionPlanModalOpen;

    this.profileSummaryOpened = false;
  }

  @action private toggleProfileSummary() {
    this.profileSummaryOpened = !this.profileSummaryOpened;
  }

  @action
  private storeSearchElement(element: HTMLElement) {
    this.searchElement = element;
    this.searchElement.focus();
  }
  @action
  private openSearchAndShowResults(term: string, typeRef?: ResolvedCodeRef) {
    this.doOpenSearchAndShowResults.perform(term, typeRef);
  }

  @action
  private setupSearch(
    doSearch: (term: string, typeRef?: ResolvedCodeRef) => void,
  ) {
    this.doSearch = doSearch;
  }

  private doOpenSearchAndShowResults = restartableTask(
    async (term: string, typeRef?: ResolvedCodeRef) => {
      this.suppressSearchClose = true;

      let wasClosed = this.searchSheetMode === SearchSheetModes.Closed;
      this.searchSheetMode = SearchSheetModes.SearchResults;
      this.searchElement?.focus();
      if (wasClosed) {
        this.args.onSearchSheetOpened?.();
      }
      this.doSearch(term, typeRef);

      // we need to prevent the onblur of the search sheet from triggering a
      // search sheet close from the click that actually triggered the search
      // sheet to show in the first place
      await timeout(250);
      this.suppressSearchClose = false;
    },
  );

  @tracked private isChooseSubscriptionPlanModalOpen = false;

  <template>
    <div
      {{handleWindowResizeModifier this.onWindowResize}}
      class={{cn 'submode-layout' this.aiAssistantVisibilityClass}}
      data-test-submode-layout
      ...attributes
    >
      <ResizablePanelGroup
        @onLayoutChange={{this.onLayoutChange}}
        @orientation='horizontal'
        class='columns'
        as |ResizablePanel ResizeHandle|
      >
        <ResizablePanel class='main-panel'>
          <div class='submode-layout-top-bar'>
            <IconButton
              @icon={{BoxelIconWithText}}
              @width='160px'
              @height='40px'
              disabled={{this.isToggleWorkspaceChooserDisabled}}
              class={{cn
                'workspace-button'
                workspace-button--dark=(not this.workspaceChooserOpened)
                workspace-button--chooser-open=this.workspaceChooserOpened
              }}
              {{on 'click' this.toggleWorkspaceChooser}}
              data-test-workspace-chooser-toggle
            />
            {{#if this.workspaceChooserOpened}}
              <div
                class='submode-layout-top-bar-center'
                {{captureElement this.storeTopBarCenterElement}}
              ></div>
            {{/if}}
            {{#if (not this.workspaceChooserOpened)}}
              <SubmodeSwitcher
                class='submode-switcher'
                @isCollapsed={{this.submodeSwitcherCollapsed}}
                @submode={{this.operatorModeStateService.state.submode}}
                @onSubmodeSelect={{this.updateSubmode}}
              />
              {{#if @newFileOptions}}
                <NewFileButton
                  class='new-file-button'
                  @dropdownOptions={{@newFileOptions}}
                  @initiallyOpened={{bool
                    this.operatorModeStateService.state.newFileDropdownOpen
                  }}
                  @isCollapsed={{this.topBarButtonsCollapsed}}
                />
              {{/if}}
              {{#if
                (eq this.operatorModeStateService.state.submode 'interact')
              }}
                <div
                  class={{cn
                    'expanded-card-header-slot'
                    has-expanded=this.operatorModeStateService.hasAnyStackItemExpanded
                  }}
                  data-test-expanded-card-header-slot
                  {{captureElement this.storeExpandedCardHeaderElement}}
                ></div>
              {{/if}}
              {{yield to='topBar'}}
            {{/if}}

            <button
              class='profile-icon-button'
              {{on 'click' this.toggleProfileSummary}}
              data-test-profile-icon-button
            >
              <Avatar
                @isReady={{this.matrixService.profile.loaded}}
                @userId={{this.matrixService.userId}}
                @displayName={{this.matrixService.profile.displayName}}
              />
            </button>
          </div>
          {{#if this.workspaceChooserOpened}}
            <WorkspaceChooser
              @topBarCenterElement={{this.topBarCenterElement}}
            />
          {{/if}}

          {{yield
            (hash
              openSearchToPrompt=this.openSearchSheetToPrompt
              openSearchToResults=this.openSearchAndShowResults
              updateSubmode=this.updateSubmode
            )
          }}
          {{#if @onCardSelectFromSearch}}
            <SearchSheet
              @mode={{this.searchSheetMode}}
              @onSetup={{this.setupSearch}}
              @onBlur={{this.closeSearchSheet}}
              @onCancel={{this.closeSearchSheet}}
              @onFocus={{this.openSearchSheetToPrompt}}
              @onSearch={{this.expandSearchToShowResults}}
              @onCardSelect={{this.handleCardSelectFromSearch}}
              @onInputInsertion={{this.storeSearchElement}}
              @onFilterChange={{this.expandSearchOnFilterChange}}
            />
          {{/if}}
          <AiAssistantToast
            @hide={{this.aiAssistantPanelService.isOpen}}
            @onViewInChatClick={{this.aiAssistantPanelService.openPanel}}
          />
          {{#unless this.aiAssistantPanelService.isAiAssistantHidden}}
            <AiAssistantButton
              class='chat-btn'
              @isActive={{this.aiAssistantPanelService.isOpen}}
              {{on
                'click'
                (if
                  this.aiAssistantPanelService.isOpen
                  this.aiAssistantPanelService.closePanel
                  this.aiAssistantPanelService.openPanel
                )
              }}
            />
          {{/unless}}
          {{#if this.profileSummaryOpened}}
            <ProfileInfoPopover
              {{onClickOutside
                this.toggleProfileSummary
                exceptSelector='.profile-icon-button'
              }}
              @toggleProfileSettings={{this.toggleProfileSettings}}
              @toggleSubscriptionPlans={{this.toggleSubscriptionPlans}}
            />
          {{/if}}
        </ResizablePanel>
        {{#if this.aiAssistantPanelService.isOpen}}
          <ResizablePanel
            class='ai-assistant-resizable-panel'
            @defaultSize={{this.aiPanelWidths.defaultWidth}}
            @minSize={{this.aiPanelWidths.minWidth}}
            @collapsible={{false}}
          >
            <AiAssistantPanel
              @onClose={{this.aiAssistantPanelService.closePanel}}
              @resizeHandle={{ResizeHandle}}
              @selectedCardRef={{@selectedCardRef}}
              class={{cn
                'ai-assistant-panel'
                left-border=this.workspaceChooserOpened
              }}
            />
          </ResizablePanel>
        {{/if}}
      </ResizablePanelGroup>
    </div>

    {{#if this.operatorModeStateService.profileSettingsOpen}}
      <ProfileSettingsModal
        @toggleProfileSettings={{this.toggleProfileSettings}}
      />
    {{/if}}

    <ChooseSubscriptionPlanModal
      @isModalOpen={{this.isChooseSubscriptionPlanModalOpen}}
      @onClose={{this.toggleSubscriptionPlans}}
    />

    <style scoped>
      .submode-layout {
        --submode-bar-item-border-radius: var(--boxel-border-radius);
        --boxel-icon-button-width: var(--container-button-size);
        --boxel-icon-button-height: var(--container-button-size);
        position: relative;
        display: flex;
        height: 100%;
        z-index: 0;
      }

      .submode-layout > .boxel-panel-group {
        width: 100%;
      }

      .ai-assistant-resizable-panel {
        max-width: 100%;
        overflow: initial;
      }

      .main-panel {
        display: flex;
        flex-direction: column;
        position: relative;
      }

      .ai-assistant-open {
        grid-template-columns: 1.5fr 0.5fr;
      }

      .chat-btn {
        position: absolute;
        bottom: var(--operator-mode-spacing);
        right: var(--operator-mode-spacing);
        background-color: var(--boxel-ai-purple);
        box-shadow: var(--submode-bar-item-box-shadow);
        z-index: var(--host-ai-panel-button-z-index);
      }

      .ai-assistant-panel {
        z-index: var(--host-ai-panel-z-index);
      }

      .submode-layout-top-bar {
        position: relative;
        width: 100%;
        max-width: 100%;
        container-type: inline-size;
        /* Lock outer box to exactly var(--stack-padding-top) — the
           same value .operator-mode-stack uses for its padding-top
           offset. Any content the bar contains (workspace button,
           submode switcher, portaled expanded-card-header pill,
           etc.) renders WITHIN this fixed height; nothing the slot
           contents do can push the bar taller. This is what lets
           interact-expanded card positioning match host-mode pixel
           for pixel — both card-tops sit at y = stack-padding-top
           and the bar is guaranteed to occupy that exact space. */
        height: var(--stack-padding-top);
        box-sizing: border-box;
        padding: var(--operator-mode-spacing);
        z-index: var(--host-top-bar-z-index);

        display: flex;
        align-items: center;
        gap: var(--operator-mode-spacing);
      }

      .submode-layout-top-bar-center {
        flex: 1;
        display: flex;
        justify-content: center;
        min-width: 0;
      }

      /* Slot for the expanded stack-item's CardHeader pill. When a
         card is expanded, stack-item portals its CardHeader here via
         the in-element block helper. The slot grows to take available
         space (so the pill can stretch to ~800px) and centers the
         pill horizontally — same horizontal position the stack card
         would occupy below. When no card is expanded, the slot is
         empty (zero rendered children). */
      .expanded-card-header-slot {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        max-width: 50rem; /* same as `stackItemMaxWidth` in stack-item.gts */
        margin: 0 auto;
      }

      .submode-switcher {
        border: none;
        border-radius: var(--submode-bar-item-border-radius);
        box-shadow: var(--submode-bar-item-box-shadow);
        outline: var(--submode-bar-item-outline);
      }
      .submode-switcher
        :deep(.submode-switcher-dropdown-trigger):focus:not(:focus-visible),
      .submode-switcher
        :deep(.submode-switcher-dropdown-trigger):focus:not(:disabled) {
        outline-offset: unset;
      }

      .new-file-button {
        border: none;
        border-radius: var(--submode-bar-item-border-radius);
        box-shadow: var(--submode-bar-item-box-shadow);
        flex-shrink: 0;
      }

      .profile-icon-button {
        --boxel-icon-button-width: var(--container-button-size);
        --boxel-icon-button-height: var(--container-button-size);

        background: none;

        padding: 0;
        margin-left: auto;

        border: none;
        border-radius: 50%;
        box-shadow: var(--submode-bar-item-box-shadow);
        z-index: var(--host-profile-z-index);
      }

      .workspace-button {
        --icon-color: var(--boxel-highlight);
        --icon-text-color: var(--boxel-light);
        --boxel-icon-button-width: 160px;
        --boxel-icon-button-height: 40px;

        border: none;
        border-radius: var(--submode-bar-item-border-radius);
        flex-shrink: 0;
        position: relative;
      }

      .workspace-button :deep(svg) {
        position: absolute;
        left: 0;
        max-width: unset;
      }

      .workspace-button:focus:not(:focus-visible) {
        outline-offset: unset;
      }
      .workspace-button:focus:not(:disabled) {
        outline-offset: 1px;
      }
      .workspace-button--dark {
        --icon-bg-opacity: 1;
        --icon-color: var(--boxel-dark);
        --icon-bg-color: var(--boxel-highlight);
        --boxel-icon-button-width: 40px;
        outline: var(--submode-bar-item-outline);
        box-shadow: var(--submode-bar-item-box-shadow);
      }
      .workspace-button--dark:focus:not(:focus-visible) {
        outline: var(--submode-bar-item-outline);
        outline-offset: 0px;
      }
      .workspace-button--dark:focus:focus-visible {
        outline-width: 2px;
        outline-offset: 0px;
      }

      :deep(.open-search-field) {
        box-shadow: var(--submode-bar-item-box-shadow);
        outline: var(--submode-bar-item-outline);
      }

      @media (max-width: 26rem) {
        .expanded-card-header-slot:not(.has-expanded) {
          display: none;
        }
      }

      @media print {
        .submode-layout-top-bar {
          display: none;
        }
      }
    </style>
  </template>
}
