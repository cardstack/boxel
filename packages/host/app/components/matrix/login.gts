import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import window from 'ember-window-mock';

import moment from 'moment';

import {
  Button,
  FieldContainer,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import { GoogleColor } from '@cardstack/boxel-ui/icons';

import {
  isMatrixError,
  type MatrixError,
} from '@cardstack/host/lib/matrix-utils';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

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
      <span class='title' data-test-sso-exchanging>Signing you in with Google…</span>
      {{#if this.error}}
        <div class='error' data-test-login-error>{{this.error}}</div>
      {{/if}}
    {{else}}
      <span class='title'>Sign in to your Boxel Account</span>
      <form data-test-login-form {{on 'submit' this.login}}>
        <FieldContainer
          @label='Email Address or Username'
          @tag='label'
          @vertical={{true}}
          class='field'
        >
          <BoxelInput
            data-test-username-field
            type='text'
            id='boxel-login-username'
            name='username'
            autocomplete='username'
            @value={{this.username}}
            @onInput={{this.setUsername}}
            @onKeyPress={{this.handleEnter}}
          />
        </FieldContainer>
        <FieldContainer
          @label='Password'
          @tag='label'
          @vertical={{true}}
          class='field'
        >
          <BoxelInput
            data-test-password-field
            type='password'
            id='boxel-login-password'
            name='password'
            autocomplete='current-password'
            @value={{this.password}}
            @onInput={{this.setPassword}}
            @onKeyPress={{this.handleEnter}}
          />
        </FieldContainer>
        <Button
          @kind='text-only'
          class='forgot-password'
          data-test-forgot-password
          {{on 'click' (fn @setMode 'forgot-password')}}
        >Forgot password?</Button>
        <Button
          class='button'
          data-test-login-btn
          @kind='primary'
          @disabled={{this.isLoginButtonDisabled}}
          @loading={{this.doLogin.isRunning}}
          {{on 'click' this.login}}
        >
          Sign in</Button>
        {{#if this.error}}
          <div class='error' data-test-login-error>{{this.error}}</div>
        {{/if}}
        {{#if this.showGoogleButton}}
          <Button
            class='button secondary-cta google-button'
            data-test-google-login-btn
            @kind='secondary-dark'
            @loading={{this.doGoogleSso.isRunning}}
            {{on 'click' this.startGoogleSso}}
          >
            <GoogleColor class='google-g' />
            Sign in with Google
          </Button>
        {{/if}}
        <Button
          class='button secondary-cta'
          data-test-register-user
          @kind='secondary-dark'
          {{on 'click' (fn @setMode 'register')}}
        >Create a new Boxel account</Button>
      </form>
    {{/if}}

    <style scoped>
      form {
        display: flex;
        flex-direction: column;
      }
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin-bottom: var(--boxel-sp-sm);
        padding: 0;
      }
      .field {
        margin-top: var(--boxel-sp);
      }
      .field :deep(input:autofill) {
        transition:
          background-color 0s 600000s,
          color 0s 600000s;
      }
      .forgot-password {
        border: none;
        padding: 0;
        margin-bottom: var(--boxel-sp-lg);
        margin-left: auto;
        color: var(--foreground);
        font: 500 var(--boxel-font-xs);
      }
      .forgot-password:hover {
        color: var(--boxel-highlight);
        background-color: transparent;
      }
      .button {
        --boxel-button-padding: var(--boxel-sp-sm);
        width: 100%;
      }
      .button :deep(.boxel-loading-indicator) {
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .secondary-cta {
        /* Sit a hair lighter than the page bg so the dark CTAs pop. */
        --boxel-button-color: var(--boxel-700);
        margin-top: var(--boxel-sp-sm);
      }
      .secondary-cta:not(:disabled):hover,
      .secondary-cta:not(:disabled):active {
        --boxel-button-color: var(--boxel-600);
      }
      .google-button {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .google-g {
        width: 1.125rem;
        height: 1.125rem;
        flex-shrink: 0;
      }
      .error {
        color: var(--boxel-error-100);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-xxs) auto 0 auto;
      }
    </style>
  </template>

  @tracked private error: string | undefined;
  @tracked private username: string | undefined;
  @tracked private password: string | undefined;
  @tracked private googleSsoAvailable = false;
  @tracked private exchangingSsoToken = false;
  @service declare private environmentService: EnvironmentService;
  @service declare private matrixService: MatrixService;
  @service declare router: RouterService;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    if (isTesting()) {
      // Names which isLoggedIn precondition is unmet when the login UI mounts
      // in a test (the intermittent cold-boot login-screen flake). Test-gated;
      // no production effect.
      console.warn(
        `[login-diag] login UI mounted: ` +
          JSON.stringify(this.matrixService.loginReadinessDebug),
      );
    }
    if (this.environmentService.googleAuthEnabled) {
      this.detectGoogleSso.perform();
    }
    // Synchronously flip into the SSO-exchanging state if the URL has a
    // loginToken — the task itself is async (awaits matrix-sdk load + token
    // exchange + matrixService.start), and without this the password form
    // would flash for ~1-2s between mount and the auth flip.
    if (new URLSearchParams(window.location.search).has('loginToken')) {
      this.exchangingSsoToken = true;
    }
    this.consumeSsoLoginToken.perform();
  }

  private get showGoogleButton() {
    return this.environmentService.googleAuthEnabled && this.googleSsoAvailable;
  }

  private get isLoginButtonDisabled() {
    return (
      !this.username || !this.password || this.error || this.doLogin.isRunning
    );
  }

  @action handleEnter(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      !this.isLoginButtonDisabled && this.login(event);
    }
  }

  @action
  private setUsername(username: string) {
    this.username = username;
    this.error = undefined;
  }

  @action
  private setPassword(password: string) {
    this.password = password;
    this.error = undefined;
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
    let params = new URLSearchParams(window.location.search);
    let token = params.get('loginToken');
    if (!token) {
      return;
    }
    // Clear the token from the URL so a refresh doesn't re-trigger the
    // single-use exchange.
    params.delete('loginToken');
    let search = params.toString();
    let newUrl =
      window.location.pathname +
      (search ? `?${search}` : '') +
      window.location.hash;
    window.history.replaceState({}, '', newUrl);

    try {
      let auth = await this.matrixService.loginWithSsoToken(token);
      // start() must stay inside the try: a failure here (e.g. realm
      // unreachable, session init) would otherwise leave us stuck on the
      // "Signing you in…" placeholder forever, with the token already
      // consumed and stripped from the URL so a refresh can't recover.
      await this.matrixService.start({
        auth,
        refreshRoutes: true,
      });
    } catch (e: any) {
      if (isMatrixError(e)) {
        this.error = `Google sign-in failed. ${extractMatrixErrorMessage(e)}`;
      } else {
        this.error = `Google sign-in failed: ${e.message}`;
      }
      // Fall back to the password form so the user can recover.
      this.exchangingSsoToken = false;
    }
  });

  private doLogin = restartableTask(async () => {
    if (!this.username) {
      throw new Error(
        `bug: should never get here: login button disabled when no username`,
      );
    } else if (!this.password) {
      throw new Error(
        `bug: should never get here: login button disabled when no password`,
      );
    }
    let auth: LoginResponse;
    try {
      auth = await this.matrixService.login(this.username, this.password);
    } catch (e: any) {
      if (isMatrixError(e)) {
        this.error = `Sign in failed. ${extractMatrixErrorMessage(e)}`;
      } else {
        this.error = `Sign in failed: ${e.message}`;
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
