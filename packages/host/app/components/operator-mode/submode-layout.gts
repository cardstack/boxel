import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import type RouterService from '@ember/routing/router-service';
import { inject as service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';
import { restartableTask, timeout } from 'ember-concurrency';

import { modifier } from 'ember-modifier';

import { TrackedObject } from 'tracked-built-ins';

import { ResizablePanelGroup } from '@cardstack/boxel-ui/components';
import { Avatar, IconButton } from '@cardstack/boxel-ui/components';
import { cn, not } from '@cardstack/boxel-ui/helpers';

import { BoxelIcon } from '@cardstack/boxel-ui/icons';

import { ResolvedCodeRef } from '@cardstack/runtime-common';

import AiAssistantButton from '@cardstack/host/components/ai-assistant/button';
import AiAssistantPanel from '@cardstack/host/components/ai-assistant/panel';
import AiAssistantToast from '@cardstack/host/components/ai-assistant/toast';
import ProfileSettingsModal from '@cardstack/host/components/operator-mode/profile/profile-settings-modal';
import ProfileInfoPopover from '@cardstack/host/components/operator-mode/profile-info-popover';

import type IndexController from '@cardstack/host/controllers';

import { assertNever } from '@cardstack/host/utils/assert-never';

import SearchSheet, {
  SearchSheetMode,
  SearchSheetModes,
} from '../search-sheet';
import SubmodeSwitcher, { Submode, Submodes } from '../submode-switcher';

import Disclaimer from './disclaimer';

import WorkspaceChooser from './workspace-chooser';

import type MatrixService from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onSearchSheetOpened?: () => void;
    onSearchSheetClosed?: () => void;
    onCardSelectFromSearch: (cardId: string) => void;
    selectedCardRef?: ResolvedCodeRef | undefined;
  };
  Blocks: {
    default: [
      {
        openSearchToPrompt: () => void;
        openSearchToResults: (term: string) => void;
      },
    ];
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

type PanelWidths = {
  defaultWidth: number | null;
  minWidth: number | null;
};

export default class SubmodeLayout extends Component<Signature> {
  @tracked private searchSheetMode: SearchSheetMode = SearchSheetModes.Closed;
  @tracked private profileSettingsOpened = false;
  @tracked private profileSummaryOpened = false;
  private aiPanelWidths: PanelWidths = new TrackedObject({
    defaultWidth: 30,
    minWidth: 25,
  });
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;
  @service private declare router: RouterService;

  private searchElement: HTMLElement | null = null;
  private suppressSearchClose = false;
  private declare doSearch: (term: string) => void;

  onWindowResize = (windowWidth: number) => {
    let aiPanelDefaultWidthInPixels = 371;
    if (windowWidth < aiPanelDefaultWidthInPixels) {
      aiPanelDefaultWidthInPixels = windowWidth;
    }
    let aiPanelDefaultWidth = (aiPanelDefaultWidthInPixels / windowWidth) * 100;

    this.aiPanelWidths.defaultWidth = aiPanelDefaultWidth;
    this.aiPanelWidths.minWidth = aiPanelDefaultWidth;
  };

  get operatorModeController(): IndexController {
    return this.operatorModeStateService.operatorModeController;
  }

  private get aiAssistantVisibilityClass() {
    return this.operatorModeStateService.aiAssistantOpen
      ? 'ai-assistant-open'
      : 'ai-assistant-closed';
  }

  private get allStackItems() {
    return this.operatorModeStateService.state?.stacks.flat() ?? [];
  }

  private get lastCardIdInRightMostStack() {
    if (this.allStackItems.length <= 0) {
      return null;
    }

    let stackItem = this.allStackItems[this.allStackItems.length - 1];
    return stackItem.url;
  }

  private get isToggleWorkspaceChooserDisabled() {
    return this.operatorModeStateService.state.stacks.length === 0;
  }

  @action private updateSubmode(submode: Submode) {
    switch (submode) {
      case Submodes.Interact:
        this.operatorModeStateService.updateCodePath(null);
        break;
      case Submodes.Code:
        this.operatorModeStateService.updateCodePath(
          this.lastCardIdInRightMostStack
            ? new URL(this.lastCardIdInRightMostStack + '.json')
            : null,
        );
        break;
      default:
        throw assertNever(submode);
    }

    this.operatorModeStateService.updateSubmode(submode);
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

  @action private openSearchSheetToPrompt() {
    if (this.searchSheetMode === SearchSheetModes.Closed) {
      this.searchSheetMode = SearchSheetModes.SearchPrompt;
    }

    this.searchElement?.focus();
    this.args.onSearchSheetOpened?.();
  }

  @action private async handleCardSelectFromSearch(cardId: string) {
    this.args.onCardSelectFromSearch(cardId);
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
    this.profileSettingsOpened = !this.profileSettingsOpened;

    this.profileSummaryOpened = false;
  }

  @action private toggleProfileSummary() {
    this.profileSummaryOpened = !this.profileSummaryOpened;
  }

  @action
  private storeSearchElement(element: HTMLElement) {
    this.searchElement = element;
  }
  @action
  private openSearchAndShowResults(term: string) {
    this.doOpenSearchAndShowResults.perform(term);
  }

  @action
  private setupSearch(doSearch: (term: string) => void) {
    this.doSearch = doSearch;
  }

  private doOpenSearchAndShowResults = restartableTask(async (term: string) => {
    this.suppressSearchClose = true;

    let wasClosed = this.searchSheetMode === SearchSheetModes.Closed;
    this.searchSheetMode = SearchSheetModes.SearchResults;
    this.searchElement?.focus();
    if (wasClosed) {
      this.args.onSearchSheetOpened?.();
    }
    this.doSearch(term);

    // we need to prevent the onblur of the search sheet from triggering a
    // search sheet close from the click that actually triggered the search
    // sheet to show in the first place
    await timeout(250);
    this.suppressSearchClose = false;
  });

  <template>
    <Disclaimer />

    <div
      {{handleWindowResizeModifier this.onWindowResize}}
      class='submode-layout {{this.aiAssistantVisibilityClass}}'
    >
      <ResizablePanelGroup
        @orientation='horizontal'
        class='columns'
        as |ResizablePanel ResizeHandle|
      >
        <ResizablePanel class='main-panel'>
          <div class='top-left-menu'>
            <IconButton
              @icon={{BoxelIcon}}
              @width='40px'
              @height='40px'
              disabled={{this.isToggleWorkspaceChooserDisabled}}
              class={{cn
                'workspace-button'
                dark-icon=(not this.workspaceChooserOpened)
              }}
              {{on 'click' this.toggleWorkspaceChooser}}
              data-test-workspace-chooser-toggle
            />
            {{#if this.workspaceChooserOpened}}
              <span
                class='boxel-title'
                data-test-submode-layout-title
              >BOXEL</span>
            {{else}}
              <SubmodeSwitcher
                @submode={{this.operatorModeStateService.state.submode}}
                @onSubmodeSelect={{this.updateSubmode}}
              />
            {{/if}}
          </div>
          {{#if this.workspaceChooserOpened}}
            <WorkspaceChooser />
          {{/if}}

          {{yield
            (hash
              openSearchToPrompt=this.openSearchSheetToPrompt
              openSearchToResults=this.openSearchAndShowResults
            )
          }}
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
          <SearchSheet
            @mode={{this.searchSheetMode}}
            @onSetup={{this.setupSearch}}
            @onBlur={{this.closeSearchSheet}}
            @onCancel={{this.closeSearchSheet}}
            @onFocus={{this.openSearchSheetToPrompt}}
            @onSearch={{this.expandSearchToShowResults}}
            @onCardSelect={{this.handleCardSelectFromSearch}}
            @onInputInsertion={{this.storeSearchElement}}
          />
          <AiAssistantToast
            @hide={{this.operatorModeStateService.aiAssistantOpen}}
            @onViewInChatClick={{this.operatorModeStateService.toggleAiAssistant}}
          />
          <AiAssistantButton
            class='chat-btn'
            @isActive={{this.operatorModeStateService.aiAssistantOpen}}
            {{on 'click' this.operatorModeStateService.toggleAiAssistant}}
          />
        </ResizablePanel>
        {{#if this.operatorModeStateService.aiAssistantOpen}}
          <ResizablePanel
            class='ai-assistant-resizable-panel'
            @defaultSize={{this.aiPanelWidths.defaultWidth}}
            @minSize={{this.aiPanelWidths.minWidth}}
            @collapsible={{false}}
          >
            <AiAssistantPanel
              @onClose={{this.operatorModeStateService.toggleAiAssistant}}
              @resizeHandle={{ResizeHandle}}
              @selectedCardRef={{@selectedCardRef}}
              class='ai-assistant-panel
                {{if this.workspaceChooserOpened "left-border"}}'
            />
          </ResizablePanel>
        {{/if}}
      </ResizablePanelGroup>
    </div>

    {{#if this.profileSummaryOpened}}
      <ProfileInfoPopover
        {{onClickOutside
          this.toggleProfileSummary
          exceptSelector='.profile-icon-button'
        }}
        @toggleProfileSettings={{this.toggleProfileSettings}}
      />
    {{/if}}

    {{#if this.profileSettingsOpened}}
      <ProfileSettingsModal
        @toggleProfileSettings={{this.toggleProfileSettings}}
      />
    {{/if}}

    <style scoped>
      .submode-layout {
        display: flex;
        height: 100%;
      }

      .submode-layout > .boxel-panel-group {
        width: 100%;
      }

      .ai-assistant-resizable-panel {
        overflow: initial;
      }

      .main-panel {
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
        box-shadow: var(--boxel-deep-box-shadow);
        z-index: var(--host-ai-panel-button-z-index);
      }

      .ai-assistant-panel {
        z-index: var(--host-ai-panel-z-index);
      }

      .top-left-menu {
        width: var(--operator-mode-left-column);
        position: absolute;
        top: 0;
        left: 0;
        padding: var(--operator-mode-spacing);
        z-index: var(--host-top-left-menu-z-index);

        display: flex;
        align-items: center;
      }

      .boxel-title {
        color: var(--boxel-light);
        font: 900 var(--boxel-font-size-med) 'Rustica';
        letter-spacing: 3px;
      }

      .profile-icon-button {
        --boxel-icon-button-width: var(--container-button-size);
        --boxel-icon-button-height: var(--container-button-size);
        position: absolute;
        bottom: var(--operator-mode-spacing);
        left: var(--operator-mode-spacing);
        padding: 0;
        background: none;
        border: none;
        border-radius: 50px;
        z-index: var(--host-profile-z-index);
      }

      .workspace-button {
        --boxel-icon-button-width: var(--container-button-size);
        --boxel-icon-button-height: var(--container-button-size);
        border: none;
        outline: var(--boxel-border-flexible);
        margin-right: var(--operator-mode-spacing);
        border-radius: var(--boxel-border-radius);
      }
      .dark-icon {
        --icon-bg-opacity: 1;
        --icon-color: var(--boxel-dark);
      }
    </style>
  </template>
}
