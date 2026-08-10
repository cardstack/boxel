import { service } from '@ember/service';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import AiAssistantPanelPopover from './panel-popover';
import PastSessionItem, { type RoomActions } from './past-session-item';

import type { SessionRoomData } from '../../services/ai-assistant-panel-service';

import type MatrixService from '../../services/matrix-service';

interface Signature {
  Args: {
    sessions: SessionRoomData[];
    currentRoomId: string | undefined;
    roomActions: RoomActions;
    onClose: () => void;
  };
  Element: HTMLElement;
}

export default class AiAssistantPastSessionsList extends Component<Signature> {
  @service declare matrixService: MatrixService;

  checkScroll = modifier((element: HTMLElement) => {
    let checkScrollPosition = () => {
      let { scrollHeight, scrollTop, clientHeight } = element;
      let isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) <= 1;
      let hasNoScroll = scrollHeight <= clientHeight;

      if (isAtBottom || hasNoScroll) {
        this.matrixService.loadMoreAIRooms();
      }
    };

    checkScrollPosition();

    element.addEventListener('scroll', checkScrollPosition);

    return () => {
      element.removeEventListener('scroll', checkScrollPosition);
    };
  });

  <template>
    <div class='past-sessions-menu'>
      <AiAssistantPanelPopover
        @onClose={{@onClose}}
        data-test-past-sessions
        ...attributes
      >
        <:header>
          Past Sessions
        </:header>
        <:body>
          {{#if @sessions}}
            <ul class='past-sessions' {{this.checkScroll}}>
              {{#each @sessions key='roomId' as |session|}}
                <PastSessionItem
                  @session={{session}}
                  @isCurrentRoom={{eq session.roomId @currentRoomId}}
                  @actions={{@roomActions}}
                />
              {{/each}}
              {{#if this.matrixService.isLoadingMoreAIRooms}}
                <li
                  class='loading-indicator-container'
                  data-test-loading-more-rooms
                >
                  <LoadingIndicator
                    @color='var(--boxel-dark)'
                    class='loading-indicator'
                  />
                </li>
              {{/if}}
            </ul>
          {{else}}
            <div class='empty-collection'>
              No past sessions to show.
            </div>
          {{/if}}
        </:body>
      </AiAssistantPanelPopover>
    </div>

    <style scoped>
      .past-sessions-menu :deep(.panel-popover) {
        left: 30px;
        right: 30px;
        max-width: none;
        background: #3b394b;
        border: 1px solid rgba(255, 255, 255, 0.25);
      }
      .past-sessions-menu :deep(.header) {
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .past-sessions-menu :deep(.session:hover),
      .past-sessions-menu
        :deep(.session:has(.menu-button[aria-expanded='true'])) {
        background-color: #272330;
      }
      .past-sessions-menu :deep(.body) {
        scroll-timeline: --past-sessions-scroll-timeline block;
      }
      .past-sessions {
        list-style-type: none;
        padding: 0;
        margin: 0;
        margin-bottom: var(--boxel-sp-xs);
      }
      .empty-collection {
        padding: var(--boxel-sp-sm);
        text-align: center;
        color: var(--boxel-450);
      }
      .loading-indicator-container {
        padding: var(--boxel-sp-sm);
        text-align: center;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .loading-indicator {
        margin: 0 auto;
      }
    </style>
  </template>
}
