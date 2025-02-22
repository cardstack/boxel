import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import { IconButton } from '@cardstack/boxel-ui/components';
import { DropdownArrowFilled } from '@cardstack/boxel-ui/icons';

import { SessionRoomData } from './panel';
import AiAssistantPanelPopover from './panel-popover';
import PastSessionItem, { type RoomActions } from './past-session-item';

interface Signature {
  Args: {
    sessions: SessionRoomData[];
    roomActions: RoomActions;
    onClose: () => void;
  };
  Element: HTMLElement;
}

const AiAssistantPastSessionsList: TemplateOnlyComponent<Signature> = <template>
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
        <ul class='past-sessions'>
          {{#each @sessions key='roomId' as |session|}}
            <PastSessionItem @session={{session}} @actions={{@roomActions}} />
          {{/each}}
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
    }
    .empty-collection {
      padding: var(--boxel-sp-sm);
      text-align: center;
      color: var(--boxel-450);
    }
  </style>
</template>;

export default AiAssistantPastSessionsList;
