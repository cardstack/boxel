import { service } from '@ember/service';
import Component from '@glimmer/component';

import RouteTemplate from 'ember-route-template';
import window from 'ember-window-mock';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import type MatrixService from '@cardstack/host/services/matrix-service';

class Loading extends Component {
  @service declare private matrixService: MatrixService;

  // Use the dark auth palette when this boot leads to the auth pages: either an
  // SSO redirect is being consumed (`?loginToken`) or there is no persisted
  // session, so the user will land on the (dark) login page. A returning user
  // keeps the purple background, which blends into the operator-mode workspace.
  private get isAuthBoot() {
    return (
      new URLSearchParams(window.location.search).has('loginToken') ||
      !this.matrixService.hasPersistedSession
    );
  }

  <template>
    <div
      id='host-loading'
      class={{if this.isAuthBoot 'theme-dark'}}
      data-test-host-loading
    >
      <div class='loading-container'>
        <div class='loading-indicator'>
          <LoadingIndicator @color='#00FFBA' />
        </div>
        <div class='loading-text'>Loading…</div>
      </div>
    </div>

    <style scoped>
      #host-loading {
        background-color: #686283;
        display: flex;
        align-items: center;
        justify-items: center;
        height: 100vh;
      }

      #host-loading.theme-dark {
        background-color: #191624;
      }

      .loading-container {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }

      .loading-indicator {
        --boxel-loading-indicator-size: 20px;
      }

      .loading-text {
        color: #fff;
        font-size: 12px;
        font-weight: 600;
      }
    </style>
  </template>
}

export default RouteTemplate(Loading);
