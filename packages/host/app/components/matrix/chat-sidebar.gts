import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import UserProfile from './user-profile';
import Login from './login';
import RegisterUser from './register-user';
import RoomsManager from './rooms-manager';
import { IconButton } from '@cardstack/boxel-ui';
import { tracked } from '@glimmer/tracking';
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
            @icon='icon-x'
            @width='20px'
            @height='20px'
            class='icon-button'
            aria-label='Close'
            {{on 'click' @onClose}}
            data-test-close-chat-button
          />
        </div>
        {{#if this.showLoggedInMode}}
          <UserProfile />
          <RoomsManager />
        {{else}}
          {{#if this.isRegistrationMode}}
            <RegisterUser @onCancel={{this.toggleRegistrationMode}} />
          {{else}}
            <Login />
            <button
              class='link registration-link'
              data-test-register-user
              {{on 'click' this.toggleRegistrationMode}}
            >Register new user</button>
          {{/if}}
        {{/if}}
      </div>
    </div>

    <style>
      .chat-sidebar {
        background-color: var(--boxel-light);
        height: 100vh;
        overflow-y: auto;
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
        display: flex;
        justify-content: flex-end;
      }
      .registration-link {
        background: none;
        padding: 0;
        border: none;
      }

    </style>
  </template>

  @service declare matrixService: MatrixService;
  @tracked isRegistrationMode = false;

  get showLoggedInMode() {
    return this.matrixService.isLoggedIn && !this.isRegistrationMode;
  }

  @action
  toggleRegistrationMode() {
    this.isRegistrationMode = !this.isRegistrationMode;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Matrix::ChatSidebar': typeof ChatSidebar;
  }
}
