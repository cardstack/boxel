import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';
import { restartableTask, timeout } from 'ember-concurrency';

import { use, resource } from 'ember-resources';

import { TrackedObject } from 'tracked-built-ins';

import {
  ResizablePanel,
  ResizablePanelGroup,
} from '@cardstack/boxel-ui/components';
import { and, not } from '@cardstack/boxel-ui/helpers';

import AiAssistantButton from '@cardstack/host/components/ai-assistant/button';
import AiAssistantPanel from '@cardstack/host/components/ai-assistant/panel';
import AiAssistantToast from '@cardstack/host/components/ai-assistant/toast';
import ProfileSettingsModal from '@cardstack/host/components/operator-mode/profile/profile-settings-modal';
import ProfileAvatarIcon from '@cardstack/host/components/operator-mode/profile-avatar-icon';
import ProfileInfoPopover from '@cardstack/host/components/operator-mode/profile-info-popover';
import ENV from '@cardstack/host/config/environment';
import { assertNever } from '@cardstack/host/utils/assert-never';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type { MessageField } from 'https://cardstack.com/base/room';

import SearchSheet, {
  SearchSheetMode,
  SearchSheetModes,
} from '../search-sheet';
import SubmodeSwitcher, { Submode, Submodes } from '../submode-switcher';

import type MatrixService from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';

const { APP } = ENV;

type PanelWidths = {
  submodePanel: number;
  aiAssistantPanel: number;
};

interface Signature {
  Element: HTMLDivElement;
  Args: {
    hideAiAssistant?: boolean;
    onSearchSheetOpened?: () => void;
    onSearchSheetClosed?: () => void;
    onCardSelectFromSearch: (card: CardDef) => void;
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

export default class SubmodeLayout extends Component<Signature> {
  @tracked private isAiAssistantVisible = false;
  @tracked private searchSheetMode: SearchSheetMode = SearchSheetModes.Closed;
  @tracked private profileSettingsOpened = false;
  @tracked private profileSummaryOpened = false;
  private panelWidths: PanelWidths = {
    submodePanel: 500,
    aiAssistantPanel: 200,
  };
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;

  private searchElement: HTMLElement | null = null;
  private suppressSearchClose = false;
  private declare doSearch: (term: string) => void;

  private get aiAssistantVisibilityClass() {
    return this.isAiAssistantVisible
      ? 'ai-assistant-open'
      : 'ai-assistant-closed';
  }

  private get allStackItems() {
    return this.operatorModeStateService.state?.stacks.flat() ?? [];
  }

  private get lastCardInRightMostStack(): CardDef | null {
    if (this.allStackItems.length <= 0) {
      return null;
    }

    return this.allStackItems[this.allStackItems.length - 1].card;
  }

  @action private updateSubmode(submode: Submode) {
    switch (submode) {
      case Submodes.Interact:
        this.operatorModeStateService.updateCodePath(null);
        break;
      case Submodes.Code:
        this.operatorModeStateService.updateCodePath(
          this.lastCardInRightMostStack
            ? new URL(this.lastCardInRightMostStack.id + '.json')
            : null,
        );
        break;
      default:
        throw assertNever(submode);
    }

    this.operatorModeStateService.updateSubmode(submode);
  }

  @action
  private toggleChat() {
    this.isAiAssistantVisible = !this.isAiAssistantVisible;
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

  @action private handleCardSelectFromSearch(card: CardDef) {
    this.args.onCardSelectFromSearch(card);
    this.closeSearchSheet();
  }

  @action private toggleProfileSettings() {
    this.profileSettingsOpened = !this.profileSettingsOpened;

    this.profileSummaryOpened = false;
  }

  @action private toggleProfileSummary() {
    this.profileSummaryOpened = !this.profileSummaryOpened;
  }

  @action
  private onPanelResize(panels: ResizablePanel[]) {
    this.panelWidths.submodePanel = panels[0]?.lengthPx;
    this.panelWidths.aiAssistantPanel = panels[1]?.lengthPx;
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

  @use private findUnseenMessage = resource(({ on }) => {
    const state: {
      value: {
        roomId: string;
        message: MessageField;
      } | null;
    } = new TrackedObject({
      value: null,
    });

    let lastMessages: Map<string, MessageField> = new Map();
    for (let resource of this.matrixService.roomResources.values()) {
      if (!resource.room) {
        continue;
      }
      let { room } = resource;
      lastMessages.set(room.roomId, room.messages[room.messages.length - 1]);
    }

    let lastMessage =
      Array.from(lastMessages).filter(
        (lastMessage) =>
          lastMessage[1] &&
          !this.matrixService.currentUserEventReadReceipts.has(
            lastMessage[1].eventId,
          ),
      )[0] ?? null;
    if (lastMessage) {
      state.value = {
        roomId: lastMessage[0],
        message: lastMessage[1],
      };

      let resetState = setTimeout(() => {
        state.value = null;
      }, 3000);
      on.cleanup(() => {
        clearInterval(resetState);
      });
    }

    return state;
  });

  get unseenMessageRoomId() {
    return this.findUnseenMessage.value?.roomId ?? '';
  }

  get unseenMessage() {
    return this.findUnseenMessage.value?.message ?? ({} as MessageField);
  }

  get isAiAssistantToastVisible() {
    return this.findUnseenMessage.value && !this.isAiAssistantVisible;
  }

  <template>
    <div class='submode-layout {{this.aiAssistantVisibilityClass}}'>
      <ResizablePanelGroup
        @orientation='horizontal'
        @onPanelChange={{this.onPanelResize}}
        class='columns'
        as |ResizablePanel ResizeHandle|
      >
        <ResizablePanel
          @defaultLengthFraction={{1}}
          @minLengthPx={{371}}
          @collapsible={{false}}
          class='main-panel'
        >
          <SubmodeSwitcher
            @submode={{this.operatorModeStateService.state.submode}}
            @onSubmodeSelect={{this.updateSubmode}}
            class='submode-switcher'
          />
          {{yield
            (hash
              openSearchToPrompt=this.openSearchSheetToPrompt
              openSearchToResults=this.openSearchAndShowResults
            )
          }}
          <div class='profile-icon-container'>
            <button
              class='profile-icon-button'
              {{on 'click' this.toggleProfileSummary}}
              data-test-profile-icon-button
            >
              <ProfileAvatarIcon @userId={{this.matrixService.userId}} />
            </button>
          </div>
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
          {{#if (and APP.experimentalAIEnabled (not @hideAiAssistant))}}
            {{#if this.isAiAssistantToastVisible}}
              <AiAssistantToast
                @roomId={{this.unseenMessageRoomId}}
                @message={{this.unseenMessage}}
                @onViewInChatClick={{this.toggleChat}}
              />
            {{/if}}
            <AiAssistantButton
              class='chat-btn'
              @isActive={{this.isAiAssistantVisible}}
              {{on 'click' this.toggleChat}}
            />
          {{/if}}
        </ResizablePanel>
        {{#if (and APP.experimentalAIEnabled (not @hideAiAssistant))}}
          <ResizablePanel
            @defaultLengthFraction={{0.3}}
            @minLengthPx={{371}}
            @collapsible={{false}}
            @isHidden={{not this.isAiAssistantVisible}}
          >
            {{#if this.isAiAssistantVisible}}
              <AiAssistantPanel
                @onClose={{this.toggleChat}}
                @resizeHandle={{ResizeHandle}}
                class='ai-assistant-panel'
              />
            {{/if}}
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

    <style>
      .submode-layout {
        display: flex;
        height: 100%;
      }

      .submode-layout > .boxel-panel-group {
        width: 100%;
      }

      .main-panel {
        position: relative;
      }

      .ai-assistant-open {
        grid-template-columns: 1.5fr 0.5fr;
      }

      .chat-btn {
        position: absolute;
        bottom: var(--boxel-sp);
        right: var(--boxel-sp);
        margin-right: 0;
        background-color: var(--boxel-ai-purple);
        box-shadow: var(--boxel-deep-box-shadow);
        z-index: calc(var(--boxel-modal-z-index) - 2);
      }

      .ai-assistant-panel {
        z-index: 2;
      }

      .submode-switcher {
        position: absolute;
        top: 0;
        left: 0;
        padding: var(--boxel-sp);
        z-index: 1;
      }

      .profile-icon-container {
        bottom: 0;
        position: absolute;
        width: var(--search-sheet-closed-height);
        height: var(--search-sheet-closed-height);
        border-radius: 50px;
        margin-left: var(--boxel-sp);
        z-index: 1;
      }

      .profile-icon-button {
        border: 0;
        padding: 0;
        background: transparent;
      }
    </style>
  </template>
}
