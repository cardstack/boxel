import { fn } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import LoadingIndicator from '@cardstack/secure-origin/components/loading-indicator.gts';
import SignInScreen from '@cardstack/secure-origin/screens/sign-in.gts';
import { restartableTask } from 'ember-concurrency';

import window from 'ember-window-mock';

import moment from 'moment';

import {
  CredentialFields,
  credentialFieldsError,
} from '@cardstack/host/lib/credential-fields';
import {
  isMatrixError,
  type MatrixError,
} from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  consumeLoginTokenFromUrl,
  peekLoginToken,
} from '@cardstack/host/utils/login-token';

import CredentialFieldsFrame from './credential-fields';

import type { AuthMode } from './auth';
import type { LoginResponse } from 'matrix-js-sdk';

const GOOGLE_IDP_ID = 'oidc-google';

interface Signature {
  Args: {
    setMode: (mode: AuthMode) => void;
  };
}

export default class Login extends Component<Signature> {
  <template>
    {{#if this.exchangingSsoToken}}
      <div class='centered-loading' data-test-sso-exchanging>
        <span class='loading-title'>Signing you in…</span>
        <LoadingIndicator class='loading-spinner' />
        {{#if this.error}}
          <div class='error' data-test-login-error>{{this.error}}</div>
        {{/if}}
      </div>
    {{else}}
      <SignInScreen
        @google={{this.showGoogleButton}}
        @googleSubtitle={{this.showGoogleSubtitle}}
        @startingGoogle={{this.doGoogleSso.isRunning}}
        @submitDisabled={{this.isLoginButtonDisabled}}
        @submitting={{this.doLogin.isRunning}}
        @error={{this.error}}
        @onSubmit={{this.login}}
        @onGoogle={{this.startGoogleSso}}
        @onForgotPassword={{fn @setMode 'forgot-password'}}
        @onRegister={{fn @setMode 'register'}}
      >
        <CredentialFieldsFrame @form='login' @fields={{this.credentials}} />
      </SignInScreen>
    {{/if}}

    <style scoped>
      .centered-loading {
        align-self: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp);
        text-align: center;
      }
      .loading-title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
      }
      .loading-spinner {
        --boxel-loading-indicator-size: var(--boxel-icon-md);
        --loading-indicator-color: var(--boxel-highlight);
      }
      .error {
        color: var(--destructive-ink);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-2xs) auto 0 auto;
      }
    </style>
  </template>

  @tracked private error: string | undefined;
  // The username and password are typed into a frame on the secure origin,
  // which signs in and hands back only the session.
  private credentials = new CredentialFields();
  @tracked private googleSsoAvailable = false;
  @tracked private exchangingSsoToken = false;
  @tracked private startedFromLoginToken = false;
  @service declare private matrixService: MatrixService;
  @service declare router: RouterService;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.credentials.onInput = () => (this.error = undefined);
    this.credentials.onSubmitRequest = () => this.submitIfReady();
    if (isTesting()) {
      // Names which isLoggedIn precondition is unmet when the login UI mounts
      // in a test (the intermittent cold-boot login-screen flake). Test-gated;
      // no production effect.
      console.warn(
        `[login-diag] login UI mounted: ` +
          JSON.stringify(this.matrixService.loginReadinessDebug),
      );
    }
    this.detectGoogleSso.perform();
    // Synchronously flip into the SSO-exchanging state if the URL has a
    // loginToken — the task itself is async (awaits matrix-sdk load + token
    // exchange + matrixService.start), and without this the password form
    // would flash for ~1-2s between mount and the auth flip.
    if (peekLoginToken()) {
      this.exchangingSsoToken = true;
      this.startedFromLoginToken = true;
    }
    this.consumeSsoLoginToken.perform();
  }

  private get showGoogleButton() {
    return this.googleSsoAvailable;
  }

  // The subtitle offers to *create* an account, which is only true on the
  // genuine Google entry point. A login-token hand-off (e.g. `boxel browse`)
  // that fails also falls back to this form, but its user already has an
  // account, so suppress the create-account copy there.
  private get showGoogleSubtitle() {
    return this.showGoogleButton && !this.startedFromLoginToken;
  }

  private get isLoginButtonDisabled() {
    return Boolean(
      !this.credentials.complete || this.error || this.doLogin.isRunning,
    );
  }

  private submitIfReady() {
    if (!this.isLoginButtonDisabled) {
      this.doLogin.perform();
    }
  }

  @action
  private login(ev: Event) {
    ev.preventDefault();
    this.doLogin.perform();
  }

  @action
  private startGoogleSso(ev: Event) {
    ev.preventDefault();
    this.doGoogleSso.perform();
  }

  private detectGoogleSso = restartableTask(async () => {
    try {
      let { flows } = await this.matrixService.loginFlows();
      this.googleSsoAvailable = flows.some(
        (f: any) =>
          f.type === 'm.login.sso' &&
          Array.isArray(f.identity_providers) &&
          f.identity_providers.some((p: any) => p.id === GOOGLE_IDP_ID),
      );
    } catch {
      this.googleSsoAvailable = false;
    }
  });

  private doGoogleSso = restartableTask(async () => {
    try {
      let url = await this.matrixService.getSsoLoginUrl(
        window.location.href,
        GOOGLE_IDP_ID,
      );
      window.location.assign(url);
    } catch (e: any) {
      this.error = `Could not start Google sign-in: ${e.message}`;
    }
  });

  private consumeSsoLoginToken = restartableTask(async () => {
    // Clears the token from the URL so a refresh doesn't re-trigger the
    // single-use exchange.
    let handoff = consumeLoginTokenFromUrl();
    if (!handoff) {
      return;
    }

    try {
      let auth = await this.matrixService.loginWithSsoToken(handoff);
      // start() must stay inside the try: a failure here (e.g. realm
      // unreachable, session init) would otherwise leave us stuck on the
      // "Signing you in…" placeholder forever, with the token already
      // consumed and stripped from the URL so a refresh can't recover.
      await this.matrixService.start({
        auth,
        refreshRoutes: true,
      });
    } catch (e: any) {
      if (
        isMatrixError(e) &&
        e.httpStatus === 403 &&
        e.errcode === 'M_FORBIDDEN'
      ) {
        // A single-use, short-lived login token that's spent or expired comes
        // back as 403 M_FORBIDDEN, so name the recovery instead of the
        // password-form "check your credentials" advice extractMatrixErrorMessage
        // returns. Other 403s (e.g. M_USER_DEACTIVATED) fall through — telling a
        // deactivated user to mint a fresh link would just loop them.
        this.error = `This sign-in link has expired or was already used. Get a new one and try again.`;
      } else if (isMatrixError(e)) {
        this.error = `Sign-in failed. ${extractMatrixErrorMessage(e)}`;
      } else {
        this.error = `Sign-in failed: ${e.message}`;
      }
      // Fall back to the password form so the user can recover.
      this.exchangingSsoToken = false;
    }
  });

  private doLogin = restartableTask(async () => {
    if (!(await this.credentials.validate())) {
      return;
    }
    if (!this.credentials.complete) {
      throw new Error(
        `bug: should never get here: login button disabled when the username or password is missing`,
      );
    }
    let auth: LoginResponse;
    try {
      let result = await this.credentials.submit({ operation: 'login' });
      if (!result.ok) {
        throw credentialFieldsError(result);
      }
      auth = result.body as LoginResponse;
    } catch (e: any) {
      if (isMatrixError(e)) {
        this.error = `Sign-in failed. ${extractMatrixErrorMessage(e)}`;
      } else {
        this.error = `Sign-in failed: ${e.message}`;
      }

      throw e;
    }
    if (auth) {
      // note that any commands after this await will not be executed as the act
      // of starting the matrix service sets tracked properties that result in this
      // component being removed from the DOM and destroyed. Keep in mind that in EC tasks,
      // awaits are really just syntactic sugar for yields, and that we yield to
      // this.matrixService.start()
      await this.matrixService.start({
        auth,
        refreshRoutes: true,
      });
    } else {
      throw new Error(
        `bug: should be impossible to get here - successful matrix login with no auth response`,
      );
    }
  });
}

export function extractMatrixErrorMessage(e: MatrixError) {
  if (e.httpStatus === 403) {
    return 'Please check your credentials and try again.';
  } else if (e.httpStatus === 429) {
    if (e.data.retry_after_ms) {
      moment.relativeTimeRounding(Math.ceil);
      return `Too many failed attempts, try again ${moment
        .duration(e.data.retry_after_ms)
        .humanize(true)}.`;
    }
    return 'Too many failed attempts, try again later.';
  } else {
    return `Unknown error ${e.httpStatus}: ${e.data.error}`;
  }
}
