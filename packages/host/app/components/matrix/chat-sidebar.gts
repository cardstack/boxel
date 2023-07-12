import Component from '@glimmer/component';
import { service } from '@ember/service';
import UserProfile from './user-profile';
import Login from './login';
import RoomsManager from './rooms-manager';
import type MatrixService from '../../services/matrix-service';

export default class ChatSidebar extends Component {
  <template>
    <div class='chat-sidebar'>
      <div class='chat-sidebar__inner'>
        {{#if this.matrixService.isLoggedIn}}
          <UserProfile />
          <RoomsManager />
        {{else}}
          <Login />
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
        padding-bottom: calc(var(--search-sheet-closed-height) + var(--boxel-sp));
      }
    </style>
  </template>

  @service declare matrixService: MatrixService;
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Matrix::ChatSidebar': typeof ChatSidebar;
  }
}
