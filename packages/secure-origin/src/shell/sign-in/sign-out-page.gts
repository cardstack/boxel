// The `sign-out` page, where the app sends the user once it has signed out of
// its own session: it ends the window's session, here and on the server, and
// goes back to the app page named by `return` in the address's fragment,
// signed out. A `return` that isn't on one of the app's origins goes nowhere:
// the page shows the window's sign-in instead.
import type Owner from '@ember/owner';
import Component from '@glimmer/component';

import {
  appOrigins,
  forgetReturn,
  returnFromFragment,
} from '../../security/app-handoff.js';
import { readConfig, signOut } from '../../security/session.js';
import { navigation } from '../navigation.js';
import { pageURL } from '../urls.js';

import MessagePage from './message-page.gts';

export default class SignOutPage extends Component {
  <template><MessagePage @heading='Signing you out…' /></template>

  private config = readConfig();

  constructor(owner: Owner, args: object) {
    super(owner, args);
    this.signOut();
  }

  private async signOut() {
    let target = returnFromFragment(
      window.location.hash,
      appOrigins(this.config),
    );
    history.replaceState(null, '', window.location.pathname);
    forgetReturn();
    try {
      await signOut(this.config);
    } catch {
      // The session is forgotten here whatever the server answers, and the
      // app's own sign-out has already asked the server to end it.
    }
    navigation.replace(target ?? pageURL('sign-in'));
  }
}
