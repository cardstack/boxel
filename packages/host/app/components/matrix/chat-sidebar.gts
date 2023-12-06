import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { IconButton } from '@cardstack/boxel-ui/components';

import { IconX } from '@cardstack/boxel-ui/icons';

import RoomsManager from './rooms-manager';

import UserProfile from './user-profile';

import type MatrixService from '../../services/matrix-service';

interface Args {
  Args: {
    onClose: () => void;
  };
}
export default class ChatSidebar extends Component<Args> {
  <template>
    <div class='chat-sidebar'>
      <div class='chat-sidebar__inner'>
        <div class='close-chat-wrapper'>
          <IconButton
            @icon={{IconX}}
            @width='20px'
            @height='20px'
            class='icon-button'
            aria-label='Close'
            {{on 'click' @onClose}}
            data-test-close-chat-button
          />
        </div>
        <UserProfile />
        <RoomsManager />
      </div>
    </div>

    <style>
      .chat-sidebar {
        background-color: var(--boxel-light);
        overflow-y: auto;
        height: 100%;
        position: relative;
      }
      .chat-sidebar__inner {
        padding-bottom: calc(
          var(--search-sheet-closed-height) + var(--boxel-sp)
        );
      }
      .close-chat-wrapper {
        position: absolute;
        top: 0;
        right: 0;
        z-index: 1;
      }
    </style>
  </template>

  @service declare matrixService: MatrixService;

  constructor(owner: Owner, args: Args['Args']) {
    super(owner, args);

    if (!this.matrixService.isLoggedIn) {
      throw new Error(
        `cannot render ChatSidebar component when not logged into Matrix`,
      );
    }
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Matrix::ChatSidebar': typeof ChatSidebar;
  }
}
