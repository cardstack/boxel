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
  BoxelInput,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { GoogleColor } from '@cardstack/boxel-ui/icons';

import {
  isMatrixError,
  type MatrixError,
} from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

import AuthButton from './auth-button';
import AuthFormField from './auth-form-field';

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
        <span class='loading-title'>Signing you in with Google</span>
        <LoadingIndicator class='loading-spinner' />
        {{#if this.error}}
          <div class='error' data-test-login-error>{{this.error}}</div>
        {{/if}}
      </div>
    {{else}}
      <span class='title'>Sign in to your Boxel Account</span>
      {{#if this.showGoogleButton}}
        <p class='subtitle'>Use Google to get started in one tap - we'll create
          your Boxel account if you don't have one yet.</p>
      {{/if}}
      <form data-test-login-form {{on 'submit' this.login}}>
        {{#if this.showGoogleButton}}
          <AuthButton
            class='google-button'
            data-test-google-login-btn
            @loading={{this.doGoogleSso.isRunning}}
            {{on 'click' this.startGoogleSso}}
          >
            <GoogleColor class='google-g' aria-hidden='true' />
            Continue with Google
          </AuthButton>
          <div class='divider' aria-hidden='true'>
            <span class='divider-label'>or use your email</span>
          </div>
        {{/if}}
        <AuthFormField @label='Email Address or Username'>
          <BoxelInput
            data-test-username-field
            type='text'
            id='boxel-login-username'
            name='username'
            autocomplete='username'
            @placeholder='Your email address'
            @value={{this.username}}
            @onInput={{this.setUsername}}
            @onKeyPress={{this.handleEnter}}
          />
        </AuthFormField>
        <AuthFormField @label='Password'>
          <BoxelInput
            data-test-password-field
            type='password'
            id='boxel-login-password'
            name='password'
            autocomplete='current-password'
            @placeholder='Your password'
            @value={{this.password}}
            @onInput={{this.setPassword}}
            @onKeyPress={{this.handleEnter}}
          />
        </AuthFormField>
        <Button
          @kind='link-muted'
          @size='extra-small'
          class='forgot-password'
          data-test-forgot-password
          {{on 'click' (fn @setMode 'forgot-password')}}
        >Forgot password?</Button>
        <AuthButton
          data-test-login-btn
          @variant='primary'
          @disabled={{this.isLoginButtonDisabled}}
          @loading={{this.doLogin.isRunning}}
          {{on 'click' this.login}}
        >
          Sign In</AuthButton>
        {{#if this.error}}
          <div class='error' data-test-login-error>{{this.error}}</div>
        {{/if}}
        <p class='register-prompt'>
          <span class='register-prompt-text'>Don't have an account?</span>
          <Button
            type='button'
            class='register-link'
            @kind='link-primary'
            data-test-register-user
            {{on 'click' (fn @setMode 'register')}}
          >Create a new Boxel account</Button>
        </p>
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
      .subtitle {
        margin: 0 0 var(--boxel-sp-lg);
        color: var(--foreground);
        font: var(--boxel-font-sm);
        line-height: 1.4;
      }
      .forgot-password {
        --host-outline-offset: 2px;
        margin-top: var(--boxel-sp-4xs);
        margin-bottom: var(--boxel-sp-lg);
        margin-left: auto;
      }
      .google-button {
        margin-top: var(--boxel-sp-sm);
        gap: var(--boxel-sp-xs);
      }
      .google-g {
        width: 1.125rem;
        height: 1.125rem;
        flex-shrink: 0;
      }
      .divider {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        margin: var(--boxel-sp-lg) 0 var(--boxel-sp-xs);
      }
      .divider::before,
      .divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background-color: rgba(255, 255, 255, 0.18);
      }
      .divider-label {
        color: var(--muted-foreground);
        font: 600 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-lg);
        text-transform: uppercase;
      }
      .register-prompt {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--boxel-sp-3xs);
        margin: var(--boxel-sp) 0 0;
        font: 500 var(--boxel-font-sm);
      }
      .register-prompt-text {
        color: var(--muted-foreground);
      }
      .register-link {
        --host-outline-offset: 2px;
      }
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
        color: var(--boxel-error-100);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-2xs) auto 0 auto;
      }
    </style>
  </template>

  @tracked private error: string | undefined;
  @tracked private username: string | undefined;
  @tracked private password: string | undefined;
  @tracked private googleSsoAvailable = false;
  @tracked private exchangingSsoToken = false;
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
    this.detectGoogleSso.perform();
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
    return this.googleSsoAvailable;
  }

  private get isLoginButtonDisabled() {
    return Boolean(
      !this.username || !this.password || this.error || this.doLogin.isRunning,
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
