import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';

import { IconButton, LoadingIndicator } from '@cardstack/boxel-ui/components';
import { DropdownArrowFilled } from '@cardstack/boxel-ui/icons';

import { SessionRoomData } from './panel';
import AiAssistantPanelPopover from './panel-popover';
import PastSessionItem, { type RoomActions } from './past-session-item';

import type MatrixService from '../../services/matrix-service';

interface Signature {
  Args: {
    sessions: SessionRoomData[];
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
      let isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 1;
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
    <AiAssistantPanelPopover
      @onClose={{@onClose}}
      data-test-past-sessions
      ...attributes
    >
      <:header>
        All Sessions
        <IconButton
          @icon={{DropdownArrowFilled}}
          @width='12px'
          @height='12px'
          {{on 'click' @onClose}}
          aria-label='Close Past Sessions'
          data-test-close-past-sessions
        />
      </:header>
      <:body>
        {{#if @sessions}}
          <ul class='past-sessions' {{this.checkScroll}}>
            {{#each @sessions key='roomId' as |session|}}
              <PastSessionItem @session={{session}} @actions={{@roomActions}} />
            {{/each}}
            {{#if this.matrixService.loadingMoreAIRooms}}
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

    <style scoped>
      .past-sessions {
        list-style-type: none;
        padding: 0;
        margin: 0;
        margin-bottom: var(--boxel-sp-xs);
        max-height: 400px;
        overflow-y: auto;
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
