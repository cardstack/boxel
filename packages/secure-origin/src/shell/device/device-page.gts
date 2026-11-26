// The `device` page, where a user signs in an app that runs where there is no
// browser, such as boxel-cli over SSH (ADR 021 §1.7; RFC 8628). The app shows
// the user a code and this page's address; the user opens the page on any
// device, signs in here if the window has no session, types the code, and
// sees the same consent as the authorize page. The app finds out the answer
// from the provider when it next polls: this page sends the browser nowhere.
//
// Someone can start a sign-in and send its code to a victim, so the page asks
// for the code only after saying to enter one from your own terminal, takes
// the code only from what is typed (never from its address), and its consent
// says the same again before Allow.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { Alert } from '@cardstack/pretui/components/alert';
import { Input } from '@cardstack/pretui/components/input';
import { focusWhen } from '@cardstack/pretui/focus';

import AuthButton from '../../components/auth-button.gts';
import AuthContainer from '../../components/auth-container.gts';
import AuthFormField from '../../components/auth-form-field.gts';
import AuthHeading from '../../components/auth-heading.gts';
import BusyMessage from '../../components/busy-message.gts';
import type { ConsentDetails } from '../../security/oauth-provider.ts';
import {
  decideDeviceCode,
  lookUpDeviceCode,
  userCodeFrom,
} from '../../security/oauth-provider-device.ts';
import {
  liveSession,
  readConfig,
  signOut,
  storeSession,
  type Session,
} from '../../security/session.js';
import AccountLine from '../authorize/account-line.gts';
import Consent from '../authorize/consent.gts';
import { appNameShown } from '../authorize/copy.ts';
import MessagePage from '../sign-in/message-page.gts';
import SignInForm from '../sign-in/sign-in-form.gts';
import { pageAwaitsData } from '../telemetry.ts';

// The warning the code field is described by, so a screen reader reads it
// with the field, which takes focus as the step appears.
const WARNING_ID = 'device-code-warning';

interface ConsentState {
  name: 'consent';
  session: Session;
  userCode: string;
  details: ConsentDetails;
  renew: boolean;
  deciding: 'allow' | 'deny' | undefined;
  error: string | undefined;
}

interface CodeState {
  name: 'code';
  session: Session;
  typed: string;
  checking: boolean;
  error: string | undefined;
}

// Each state is replaced whole, never changed in place, so the page redraws.
type State =
  | { name: 'checking' }
  | { name: 'sign-in'; returned?: 'not-you' | 'ended' }
  | CodeState
  | ConsentState
  | { name: 'done'; outcome: 'allowed' | 'denied'; app: string }
  // Cancelled before a code was entered: nothing was asked for.
  | { name: 'closed' };

export default class DevicePage extends Component {
  <template>
    {{#if this.signIn}}
      <AuthContainer>
        <SignInForm
          @config={{this.config}}
          @client='window'
          @title='Sign in to Boxel to connect an app'
          @oauthPage='device'
          @onSignedIn={{this.signedIn}}
          @onCancel={{this.close}}
          @focusTitle={{this.signInReturned}}
        >
          <:intro>
            {{#if this.sessionEnded}}
              <p data-test-device-sign-in-intro data-test-device-session-ended>
                Your sign-in ended before your answer was recorded. Sign in
                again, then enter the code again.</p>
            {{else}}
              <p data-test-device-sign-in-intro>Then enter the code your
                terminal shows.</p>
            {{/if}}
          </:intro>
        </SignInForm>
      </AuthContainer>
    {{else if this.code}}
      <AuthContainer>
        <form
          class='code-form'
          method='post'
          novalidate
          {{on 'submit' this.submitCode}}
          data-test-device-code-form
        >
          <AccountLine
            class='account'
            @account={{this.code.session.user}}
            @disabled={{this.code.checking}}
            @onSignOut={{this.notYou}}
          />
          <AuthHeading class='title' data-test-device-heading>Enter the code
            shown in your terminal</AuthHeading>
          <Alert @tone='warning' id={{WARNING_ID}} data-test-device-warning>
            Only enter a code shown in your own terminal. If someone sent you
            this code, close this page.
          </Alert>
          <AuthFormField @label='Code' data-test-device-field as |_l controlId|>
            <Input
              @controlId={{controlId}}
              @type='text'
              @placeholder='XXXX-XXXX'
              @value={{this.code.typed}}
              @onInput={{this.type}}
              @describedBy={{WARNING_ID}}
              name='user_code'
              autocomplete='off'
              autocapitalize='characters'
              spellcheck='false'
              class='code-input'
              data-test-device-code
              {{focusWhen true}}
            />
          </AuthFormField>
          {{#if this.code.error}}
            <Alert @tone='danger' data-test-device-error>
              {{this.code.error}}
            </Alert>
          {{/if}}
          <div class='actions'>
            <AuthButton
              type='button'
              @variant='secondary'
              @disabled={{this.code.checking}}
              {{on 'click' this.close}}
              data-test-device-cancel
            >Cancel</AuthButton>
            <AuthButton
              type='submit'
              @variant='primary'
              @loading={{this.code.checking}}
              data-test-device-continue
            >Continue</AuthButton>
          </div>
        </form>
      </AuthContainer>
    {{else if this.consent}}
      <Consent
        @details={{this.consent.details}}
        @renew={{this.consent.renew}}
        @deciding={{this.consent.deciding}}
        @error={{this.consent.error}}
        @device={{true}}
        @onRenewChange={{this.setRenew}}
        @onAllow={{this.allow}}
        @onDeny={{this.deny}}
        @onSignOut={{this.notYou}}
      />
    {{else if this.done}}
      <div class='outcome' data-test-device-outcome={{this.done.outcome}}>
        {{#if this.allowed}}
          <MessagePage
            @heading='{{this.done.app}} is signed in'
            @info='Return to your terminal. You can see and disconnect your apps in Connected apps.'
            @focus={{true}}
          />
        {{else}}
          <MessagePage
            @heading='{{this.done.app}} was not signed in'
            @info='Nothing was shared. You can close this page.'
            @focus={{true}}
          />
        {{/if}}
      </div>
    {{else if this.closed}}
      <div class='outcome' data-test-device-closed>
        <MessagePage
          @heading='Nothing was signed in'
          @info='You can close this page.'
          @focus={{true}}
        />
      </div>
    {{else}}
      <AuthContainer>
        <BusyMessage @title='Loading…' data-test-device-loading />
      </AuthContainer>
    {{/if}}

    <style scoped>
      .code-form {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        margin: 0;
      }
      .account {
        justify-content: flex-end;
      }
      .title {
        margin: 0;
        font-size: var(--boxel-font-size-md);
        font-weight: 600;
        line-height: var(--boxel-line-height-md);
      }
      .code-input {
        text-transform: uppercase;
      }
      .actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-sm);
      }
      .outcome {
        display: contents;
      }
    </style>
  </template>

  private config = readConfig();
  // How the page's load ended, for the telemetry: once, for the first state
  // the page settles in.
  private visit = pageAwaitsData();
  private page = trackedObject<{ state: State }>({
    state: { name: 'checking' },
  });
  // Which of the page's runs may still change its state. Signing in, "Not
  // you?" and each code entered begin a new one, so an answer a newer one
  // overtook writes nothing.
  private run = 0;

  constructor(owner: Owner, args: object) {
    super(owner, args);
    this.start();
  }

  private get signIn() {
    return this.page.state.name === 'sign-in' ? this.page.state : undefined;
  }

  private get signInReturned(): boolean {
    return Boolean(this.signIn?.returned);
  }

  private get sessionEnded(): boolean {
    return this.signIn?.returned === 'ended';
  }

  private get code() {
    return this.page.state.name === 'code' ? this.page.state : undefined;
  }

  private get consent() {
    return this.page.state.name === 'consent' ? this.page.state : undefined;
  }

  private get done() {
    return this.page.state.name === 'done' ? this.page.state : undefined;
  }

  private get allowed(): boolean {
    return this.done?.outcome === 'allowed';
  }

  private get closed(): boolean {
    return this.page.state.name === 'closed';
  }

  private async start() {
    let run = ++this.run;
    let session = await liveSession(this.config);
    if (run !== this.run) {
      return;
    }
    if (!session) {
      this.page.state = { name: 'sign-in' };
      this.visit.signedOut();
      return;
    }
    this.askForCode(session);
    this.visit.loaded();
  }

  private askForCode(session: Session, error?: string) {
    this.page.state = {
      name: 'code',
      session,
      typed: '',
      checking: false,
      error,
    };
  }

  private signedIn = (session: Session) => {
    storeSession(session);
    this.run++;
    this.askForCode(session);
  };

  // "Not you?": the window's session ends, here and on the server, and the
  // page asks for a sign-in again at once, so nothing can be answered as the
  // account just disowned.
  private notYou = () => {
    let session = this.code?.session ?? this.consent?.session;
    this.run++;
    this.page.state = { name: 'sign-in', returned: 'not-you' };
    signOut(this.config, session).catch(() => {
      // Forgotten here whatever the server answers.
    });
  };

  // Cancel before a code was entered: nothing was asked for, so nothing is
  // answered. The app's code expires on its own.
  private close = () => {
    this.run++;
    this.page.state = { name: 'closed' };
  };

  private type = (value: string) => {
    let code = this.code;
    if (code) {
      this.page.state = { ...code, typed: value, error: undefined };
    }
  };

  private submitCode = async (event: Event) => {
    event.preventDefault();
    let code = this.code;
    if (!code || code.checking) {
      return;
    }
    let userCode = userCodeFrom(code.typed);
    if (!userCode) {
      this.page.state = {
        ...code,
        error:
          'Enter the 8-letter code your terminal shows, such as BCDF-GHJK.',
      };
      return;
    }
    let run = ++this.run;
    this.page.state = { ...code, checking: true, error: undefined };
    let details: ConsentDetails;
    try {
      details = await lookUpDeviceCode(this.config, code.session, userCode);
    } catch (e: any) {
      if (run !== this.run) {
        return;
      }
      if (e.status === 401) {
        this.page.state = { name: 'sign-in', returned: 'ended' };
        return;
      }
      this.page.state = {
        ...code,
        typed: code.typed,
        checking: false,
        error: e.message,
      };
      return;
    }
    if (run !== this.run) {
      return;
    }
    this.page.state = {
      name: 'consent',
      session: code.session,
      userCode,
      details,
      renew: details.renewalOffered,
      deciding: undefined,
      error: undefined,
    };
  };

  private setRenew = (checked: boolean) => {
    let consent = this.consent;
    if (consent) {
      this.page.state = { ...consent, renew: checked };
    }
  };

  private allow = () => this.decide('allow');

  private deny = () => this.decide('deny');

  // The answer is recorded once; Allow and Deny wait while it is.
  private async decide(decision: 'allow' | 'deny') {
    let consent = this.consent;
    if (!consent || consent.deciding) {
      return;
    }
    let run = this.run;
    this.page.state = { ...consent, deciding: decision, error: undefined };
    try {
      await decideDeviceCode(this.config, consent.session, consent.userCode, {
        decision,
        renew: consent.renew,
      });
    } catch (e: any) {
      if (run !== this.run) {
        return;
      }
      if (e.status === 401) {
        this.run++;
        this.page.state = { name: 'sign-in', returned: 'ended' };
        return;
      }
      if (e.code === 'expired' || e.code === 'decided') {
        // The code can't be answered any more: back to entering one, saying
        // why.
        this.askForCode(consent.session, e.message);
        return;
      }
      this.page.state = {
        ...consent,
        deciding: undefined,
        error:
          e.code === 'rate-limited'
            ? e.message
            : 'Boxel couldn’t confirm your answer. Try again.',
      };
      return;
    }
    if (run !== this.run) {
      return;
    }
    this.page.state = {
      name: 'done',
      outcome: decision === 'allow' ? 'allowed' : 'denied',
      app: appNameShown(consent.details.app),
    };
  }
}
