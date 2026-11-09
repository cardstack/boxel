// The `sign-out` page, where the app sends the user once it has signed out of
// its own session: it ends the window's session, here and on the server, and
// moves on to the sign-in page, so a user who signs in again there is handed
// back to the app page named by `return` in the address's fragment. The app,
// signed out, would only send the user straight back to that sign-in page, so
// the page never goes back to it first. A `return` that isn't on one of the
// app's origins is dropped: the sign-in then hands over to nothing.
//
// It says what it is doing as the app's own signing-out page does, with the
// same busy message in the same place, so the move from the app to this
// origin doesn't show.
import type Owner from '@ember/owner';
import Component from '@glimmer/component';

import AuthContainer from '../../components/auth-container.gts';
import BusyMessage from '../../components/busy-message.gts';
import {
  appOrigins,
  keepReturn,
  returnFromFragment,
} from '../../security/app-handoff.js';
import { readConfig, signOut } from '../../security/session.js';
import { navigation } from '../navigation.js';
import { pageURL } from '../urls.js';

export default class SignOutPage extends Component {
  <template>
    <AuthContainer>
      <BusyMessage @title='Signing you out…' data-test-secure-signing-out />
    </AuthContainer>
  </template>

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
    try {
      await signOut(this.config);
    } catch {
      // The session is forgotten here whatever the server answers, and the
      // app's own sign-out has already asked the server to end it.
    }
    // Kept only once the window is signed out, so the sign-in page reads it
    // as the start of a new sign-in.
    keepReturn(target);
    // A path alone, so a route transition: no new document, and so nothing
    // painted between this page and the sign-in form.
    navigation.replace(pageURL('sign-in'));
  }
}
