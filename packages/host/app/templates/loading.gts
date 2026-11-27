import Component from '@glimmer/component';

import AuthContainer from '@cardstack/secure-origin/components/auth-container.gts';
import BusyMessage from '@cardstack/secure-origin/components/busy-message.gts';
import RouteTemplate from 'ember-route-template';
import window from 'ember-window-mock';

import { cn } from '@cardstack/boxel-ui/helpers';

import { landsOnWorkspaceChooser } from '@cardstack/host/lib/secure-sign-in';

class Loading extends Component {
  // Use the dark auth palette only when there is no persisted session: the user
  // is logged out and will land on the (dark) signed-out page. A `loginToken`
  // alongside a persisted session is an account switch that ends in the
  // workspace, and a hand-off to a signed-out app has no persisted session
  // anyway — so "no session" is the whole condition.
  //
  // Read the persisted-session signal straight from localStorage rather than
  // through MatrixService: instantiating that service runs its `cardAPIModule`
  // import-resource field, which pulls `card-api` into the loader. The loading
  // route also renders during the prerender `/render` route, so that import
  // would be captured in the render's runtime-dependency snapshot and displace
  // the fallback deps a failed render relies on. The key (`auth`) and source
  // (localStorage) match MatrixService's own `getAuth`.
  private get isAuthBoot() {
    return !window.localStorage.getItem('auth');
  }

  // A returning user's load is the color of where it lands, as index.html
  // paints it before the app renders: the dashboard's background when the page
  // opens on the dashboard, and the operator-mode purple, which blends into
  // the stacks, when it opens on a card or stack.
  private get landsOnDashboard() {
    return landsOnWorkspaceChooser();
  }

  <template>
    {{#if this.isAuthBoot}}
      <AuthContainer id='host-loading' data-test-host-loading>
        <BusyMessage @title='Loading…' />
      </AuthContainer>
    {{else}}
      <div
        id='host-loading'
        class={{cn 'session-loading' on-dashboard=this.landsOnDashboard}}
        data-test-host-loading
      >
        <BusyMessage @title='Loading…' />
      </div>
    {{/if}}

    <style scoped>
      .session-loading {
        --foreground: var(--boxel-light);
        background-color: #686283;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
      }
      .session-loading.on-dashboard {
        background-color: var(--host-dashboard-background);
      }
    </style>
  </template>
}

export default RouteTemplate(Loading);
