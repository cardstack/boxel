import Component from '@glimmer/component';

import RouteTemplate from 'ember-route-template';
import window from 'ember-window-mock';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

class Loading extends Component {
  // Use the dark auth palette when this boot leads to the auth pages: either an
  // SSO redirect is being consumed (`?loginToken`) or there is no persisted
  // session, so the user will land on the (dark) login page. A returning user
  // keeps the purple background, which blends into the operator-mode workspace.
  //
  // Read the persisted-session signal straight from localStorage rather than
  // through MatrixService: instantiating that service runs its `cardAPIModule`
  // import-resource field, which pulls `card-api` into the loader. The loading
  // route also renders during the prerender `/render` route, so that import
  // would be captured in the render's runtime-dependency snapshot and displace
  // the fallback deps a failed render relies on. The key (`auth`) and source
  // (localStorage) match MatrixService's own `getAuth`.
  private get isAuthBoot() {
    return (
      new URLSearchParams(window.location.search).has('loginToken') ||
      !window.localStorage.getItem('auth')
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
