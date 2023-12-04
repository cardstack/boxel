import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { task } from 'ember-concurrency';

import { IconButton, LoadingIndicator } from '@cardstack/boxel-ui/components';

import { IconX } from '@cardstack/boxel-ui/icons';

import Auth from './auth';
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
        {{#if this.loadMatrix.isRunning}}
          <div class='loading'>
            <LoadingIndicator />
            <span class='loading__message'>Initializing chat...</span>
          </div>
        {{else}}
          <span data-test-matrix-ready></span>
          {{#if this.showLoggedInMode}}
            <UserProfile />
            <RoomsManager />
          {{else}}
            <Auth />
          {{/if}}
        {{/if}}
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
      .registration-link {
        margin-left: var(--boxel-sp);
      }
      .close-chat-wrapper {
        position: absolute;
        top: 0;
        right: 0;
        z-index: 1;
      }
      .registration-link {
        background: none;
        padding: 0;
        border: none;
      }
      .loading {
        display: flex;
        padding: var(--boxel-sp);
      }
      .loading__message {
        margin-left: var(--boxel-sp-xs);
      }
    </style>
  </template>

  @service declare matrixService: MatrixService;

  constructor(owner: Owner, args: Args['Args']) {
    super(owner, args);
    this.loadMatrix.perform();
  }

  get showLoggedInMode() {
    return this.matrixService.isLoggedIn;
  }

  private loadMatrix = task(async () => {
    if (this.matrixService.isLoggedIn) {
      return;
    }
    await this.matrixService.ready;
    await this.matrixService.start();
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Matrix::ChatSidebar': typeof ChatSidebar;
  }
}
