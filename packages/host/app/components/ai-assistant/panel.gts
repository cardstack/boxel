import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { IconButton } from '@cardstack/boxel-ui/components';
import { IconX } from '@cardstack/boxel-ui/icons';

import RoomsManager from '../matrix/rooms-manager';
import UserProfile from '../matrix/user-profile';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onClose: () => void;
  };
}

export default class AiAssistantPanel extends Component<Signature> {
  <template>
    <div class='ai-assistant-panel' data-test-ai-assistant-panel ...attributes>
      <IconButton
        @variant='primary'
        @icon={{IconX}}
        @width='20px'
        @height='20px'
        class='close-ai-panel'
        {{on 'click' @onClose}}
        aria-label='Remove'
        data-test-close-ai-panel
      />

      <UserProfile />
      <RoomsManager />
    </div>
    <style>
      .ai-assistant-panel {
        background-color: var(--boxel-ai-purple);
        border: none;
      }
      .close-ai-panel {
        position: absolute;
        top: var(--boxel-sp);
        right: var(--boxel-sp);
        --icon-color: var(--boxel-highlight);
      }
    </style>
  </template>
}
