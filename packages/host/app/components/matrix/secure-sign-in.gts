import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Button } from '@cardstack/pretui/components/button';
import AuthContainer from '@cardstack/secure-origin/components/auth-container.gts';
import BusyMessage from '@cardstack/secure-origin/components/busy-message.gts';
import { restartableTask } from 'ember-concurrency';
import window from 'ember-window-mock';

import {
  extractMatrixErrorMessage,
  isMatrixError,
} from '@cardstack/host/lib/matrix-utils';
import { resetPasswordParamsFrom } from '@cardstack/host/lib/reset-password-link';
import {
  clearRedirectGuard,
  framing,
  landsOnWorkspaceChooser,
  noteRedirect,
  redirectedRecently,
  secureResetPasswordURL,
  secureSignInURL,
} from '@cardstack/host/lib/secure-sign-in';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import {
  consumeLoginTokenFromUrl,
  peekLoginToken,
} from '@cardstack/host/utils/login-token';

type State =
  // Sent, or about to be sent, to the secure origin to sign in.
  | 'redirecting'
  // Back from the secure origin signed out again, too soon after being sent
  // there: the sign-in didn't complete, so the app doesn't send the user
  // round again.
  | 'incomplete'
  // In a frame, which is never navigated: the user signs in in a page of
  // their own.
  | 'framed'
  // Redeeming the login token the secure origin handed back, or finishing a
  // sign-in already under way.
  | 'signing-in'
  // The login token wouldn't redeem.
  | 'failed'
  // Ending the session on the secure origin as well, after signing out here.
  | 'signing-out'
  // A password reset link that landed on the app, on its way to the secure
  // origin's reset page.
  | 'forwarding';

// What a signed-out app shows when users sign in on the secure origin. The
// app draws no sign-in form: from the first paint it says it is taking the
// user to sign in, with a plain link that goes there, so the page works even
// when the scripted redirect never runs or the secure origin can't be
// reached. Coming back from the secure origin with a login token, it redeems
// the token, before any card is loaded, and boots the session.
export default class SecureSignIn extends Component {
  <template>
    <AuthContainer>
      <div class='centered' data-test-secure-sign-in-landing={{this.state}}>
        {{#if this.isBusy}}
          <BusyMessage
            @title={{this.busyTitle}}
            data-test-secure-sign-in-status
          />
        {{else}}
          <h1 class='title' data-test-secure-sign-in-status>
            {{this.title}}
          </h1>
          {{#if this.message}}
            <p class='message' data-test-secure-sign-in-message>
              {{this.message}}
            </p>
          {{/if}}
          <Button
            @href={{this.signInURL}}
            @variant='primary'
            @size='l'
            class='sign-in-button'
            target={{if this.framed '_blank'}}
            rel={{if this.framed 'noopener noreferrer'}}
            data-test-secure-sign-in-button
          >Sign in to Boxel</Button>
        {{/if}}
      </div>
    </AuthContainer>

    <style scoped>
      .centered {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp);
        text-align: center;
      }
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin: 0;
      }
      .message {
        margin: 0;
        color: var(--foreground);
        font: 500 var(--boxel-font-sm);
        line-height: 1.4;
      }
      .sign-in-button {
        width: 100%;
      }
    </style>
  </template>

  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  @tracked private state: State = 'redirecting';
  @tracked private error: string | undefined;
  private framed = framing.isFramed();
  private signInURL = secureSignInURL();

  constructor(owner: Owner, args: object) {
    super(owner, args);
    if (this.matrixService.isSigningOutToSecureOrigin) {
      this.state = 'signing-out';
      return;
    }
    if (peekLoginToken()) {
      this.state = 'signing-in';
      this.redeem.perform();
      return;
    }
    let { params } = resetPasswordParamsFrom(
      Object.fromEntries(new URLSearchParams(window.location.search)),
      window.location.hash,
    );
    if (params) {
      this.state = 'forwarding';
      window.location.replace(secureResetPasswordURL(params));
      return;
    }
    this.redirect();
  }

  private redirect() {
    if (this.framed) {
      this.state = 'framed';
      return;
    }
    if (redirectedRecently()) {
      this.state = 'incomplete';
      return;
    }
    this.state = 'redirecting';
    noteRedirect();
    window.location.replace(this.signInURL);
  }

  private get isBusy() {
    return (
      this.state === 'signing-in' ||
      this.state === 'signing-out' ||
      this.state === 'forwarding'
    );
  }

  private get busyTitle() {
    return this.state === 'signing-out'
      ? 'Signing you out…'
      : 'Signing you in…';
  }

  private get title() {
    switch (this.state) {
      case 'incomplete':
        return 'Sign-in didn’t complete';
      case 'failed':
        return 'Sign-in didn’t complete';
      case 'framed':
        return 'Sign in to Boxel';
      default:
        return 'Taking you to sign in…';
    }
  }

  private get message() {
    if (this.state === 'failed') {
      return this.error;
    }
    if (this.state === 'framed') {
      return 'Sign in in a new tab, then come back here.';
    }
    return undefined;
  }

  private redeem = restartableTask(async () => {
    // Single-use: taken out of the address before it is redeemed, so a reload
    // can't try it again.
    let handoff = consumeLoginTokenFromUrl();
    if (!handoff) {
      this.redirect();
      return;
    }
    // The session's first screen paints as soon as the session is up, before
    // the index route opens the workspace chooser, so a page the route will
    // open it on shows it from that first screen.
    if (landsOnWorkspaceChooser()) {
      this.operatorModeStateService.showWorkspaceChooserBeforeBoot();
    }
    try {
      let auth = await this.matrixService.loginWithSsoToken(handoff);
      await this.matrixService.start({ auth, refreshRoutes: true });
      // `start()` handles a failure after the Matrix login by signing out
      // again rather than throwing, so only a session that is up counts.
      if (!this.matrixService.isLoggedIn) {
        throw new Error('the session could not be started');
      }
      // Only now is the next signed-out arrival a new one, which redirects.
      clearRedirectGuard();
    } catch (e: any) {
      if (
        isMatrixError(e) &&
        e.httpStatus === 403 &&
        e.errcode === 'M_FORBIDDEN'
      ) {
        this.error =
          'This sign-in link has expired or was already used. Sign in again.';
      } else if (isMatrixError(e)) {
        this.error = `Sign-in failed. ${extractMatrixErrorMessage(e)}`;
      } else {
        this.error = `Sign-in failed: ${e.message}`;
      }
      this.state = 'failed';
    }
  });
}
