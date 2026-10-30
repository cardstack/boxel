import Route from '@ember/routing/route';

import window from 'ember-window-mock';

import { secureCliAuthURL } from '@cardstack/host/lib/secure-sign-in';

// Where a `boxel` CLI sends the browser to authorize a machine
// (`/cli-auth?port=&state=`). The app draws no password form, so it sends the
// browser on to the secure origin's CLI sign-in with the same port and state,
// and holds the transition so its own page never renders.
export default class CliAuthRoute extends Route {
  beforeModel() {
    let params = new URLSearchParams(window.location.search);
    window.location.replace(
      secureCliAuthURL(params.get('port') ?? '', params.get('state') ?? ''),
    );
    return new Promise<never>(() => {});
  }
}
