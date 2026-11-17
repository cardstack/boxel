// The `authorize` page, where Boxel's OAuth provider sends the browser when an
// app asks to connect (ADR 021 §1.7): sign-in when the window has no session,
// then the flow's consent, then a moment saying where the browser goes next.
//
// The provider sends the browser to `authorize?interaction=<id>`. The page
// reads the flow's details and records the answer under the window's own
// session (`oauth-provider.ts`), then sends the browser to the finish route
// with the ticket it is given, replacing this page in the history so Back from
// the app doesn't land on a consent already answered. Cancel at sign-in, with
// no session to answer with, finishes the flow as denied.
//
// An address carrying `error` is a flow the provider refused before consent,
// and the page shows that the request can't continue; it never starts consent
// for it. So does an address whose interaction ID isn't one, without asking
// the realm server anything.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { Alert } from '@cardstack/pretui/components/alert';

import AuthButton from '../../components/auth-button.gts';
import AuthContainer from '../../components/auth-container.gts';
import BusyMessage from '../../components/busy-message.gts';
import {
  authorizeRequest,
  cancelURL,
  consentDetails,
  decideConsent,
  finishURL,
  type ConsentDetails,
} from '../../security/oauth-provider.ts';
import {
  liveSession,
  readConfig,
  signOut,
  storeSession,
  type Session,
} from '../../security/session.js';
import { navigation } from '../navigation.js';
import SignInForm from '../sign-in/sign-in-form.gts';
import MessagePage from '../sign-in/message-page.gts';
import { pageAwaitsData } from '../telemetry.ts';

import Consent from './consent.gts';
import { appNameShown } from './copy.ts';
import Outcome from './outcome.gts';
import RequestEnded from './request-ended.gts';

interface ConsentState {
  name: 'consent';
  session: Session;
  details: ConsentDetails;
  renew: boolean;
  deciding: 'allow' | 'deny' | undefined;
  error: string | undefined;
}

// Each state is replaced whole, never changed in place, so the page redraws.
type State =
  | { name: 'checking' }
  | { name: 'sign-in' }
  | { name: 'loading' }
  | { name: 'unavailable' }
  | ConsentState
  | { name: 'leaving'; outcome: 'allowed' | 'denied'; details: ConsentDetails }
  | { name: 'ended' };

// A refusal that means the flow can't be answered here any more: it expired,
// was already answered, or the request was never one the provider would take.
const ENDED = new Set([400, 403, 404, 409]);

export default class AuthorizePage extends Component {
  <template>
    {{#if (this.is 'sign-in')}}
      <AuthContainer>
        <SignInForm
          @config={{this.config}}
          @client='window'
          @title='Sign in to Boxel to connect an app'
          @interaction={{this.interaction}}
          @onSignedIn={{this.signedIn}}
          @onCancel={{this.cancel}}
        >
          <:intro>
            <p data-test-authorize-sign-in-intro>You’ll see which app and what
              it can do on the next step.</p>
          </:intro>
        </SignInForm>
      </AuthContainer>
    {{else if this.consent}}
      <Consent
        @details={{this.consent.details}}
        @renew={{this.consent.renew}}
        @deciding={{this.consent.deciding}}
        @error={{this.consent.error}}
        @onRenewChange={{this.setRenew}}
        @onAllow={{this.allow}}
        @onDeny={{this.deny}}
        @onSignOut={{this.notYou}}
      />
    {{else if this.leaving}}
      <Outcome
        @outcome={{this.leaving.outcome}}
        @name={{this.leavingName}}
        @returnsTo={{this.leaving.details.app.shown}}
      />
    {{else if (this.is 'unavailable')}}
      <MessagePage @heading='Boxel couldn’t load this request'>
        <Alert @tone='danger' data-test-authorize-unavailable>Boxel could not be
          reached, or couldn’t answer. Your answer hasn’t been given yet.</Alert>
        <div class='retry'>
          <AuthButton
            type='button'
            @variant='secondary'
            {{on 'click' this.retry}}
            data-test-authorize-retry
          >Try again</AuthButton>
        </div>
      </MessagePage>
    {{else if (this.is 'ended')}}
      <RequestEnded />
    {{else}}
      <AuthContainer>
        <BusyMessage @title='Loading…' data-test-authorize-loading />
      </AuthContainer>
    {{/if}}

    <style scoped>
      .retry {
        display: flex;
        flex-direction: column;
        margin-top: var(--boxel-sp-lg);
      }
    </style>
  </template>

  private config = readConfig();
  private request = authorizeRequest(window.location.search);
  // How the page's load ended, for the telemetry: once, for the first state
  // the page settles in.
  private visit = pageAwaitsData();
  private page = trackedObject<{ state: State }>({
    state: { name: 'checking' },
  });

  constructor(owner: Owner, args: object) {
    super(owner, args);
    window.addEventListener('pageshow', this.shown);
    if (this.request.kind === 'consent') {
      this.start();
    } else {
      this.page.state = { name: 'ended' };
      this.visit.loaded();
    }
  }

  willDestroy() {
    super.willDestroy();
    window.removeEventListener('pageshow', this.shown);
  }

  private get interaction(): string | undefined {
    return this.request.kind === 'consent'
      ? this.request.interaction
      : undefined;
  }

  private is = (name: State['name']) => this.page.state.name === name;

  private get consent() {
    let state = this.page.state;
    return state.name === 'consent' ? state : undefined;
  }

  private get leaving() {
    let state = this.page.state;
    return state.name === 'leaving' ? state : undefined;
  }

  private get leavingName(): string {
    return this.leaving ? appNameShown(this.leaving.details.app) : '';
  }

  // Back from the app can bring this page back as it was left, from the
  // browser's cache, showing a consent already answered. It starts again,
  // and finds out the flow was decided.
  private shown = (event: PageTransitionEvent) => {
    if (event.persisted && this.request.kind === 'consent') {
      this.start();
    }
  };

  private async start() {
    this.page.state = { name: 'checking' };
    let session = await liveSession(this.config);
    if (!session) {
      this.page.state = { name: 'sign-in' };
      this.visit.signedOut();
      return;
    }
    await this.load(session);
  }

  private async load(session: Session, retried = false) {
    let interaction = this.interaction!;
    this.page.state = { name: 'loading' };
    let details: ConsentDetails;
    try {
      details = await consentDetails(this.config, session, interaction);
    } catch (e: any) {
      if (e.status === 401) {
        // The server's clock can end the session before this window's does;
        // one bound to the app's session is renewed then, once.
        let renewed = retried ? undefined : await liveSession(this.config);
        if (renewed && renewed.token !== session.token) {
          await this.load(renewed, true);
          return;
        }
        this.page.state = { name: 'sign-in' };
        this.visit.signedOut();
        return;
      }
      this.page.state = ENDED.has(e.status)
        ? { name: 'ended' }
        : { name: 'unavailable' };
      this.visit.loadFailed(e);
      return;
    }
    this.page.state = {
      name: 'consent',
      session,
      details,
      renew: details.renewalOffered,
      deciding: undefined,
      error: undefined,
    };
    this.visit.loaded();
  }

  private retry = () => {
    this.start();
  };

  private signedIn = (session: Session) => {
    storeSession(session);
    this.load(session);
  };

  // "Not you?": the window's session ends, here and on the server, and the
  // same flow asks for a sign-in again.
  private notYou = async () => {
    try {
      await signOut(this.config);
    } catch {
      // The session is forgotten here whatever the server answers.
    }
    this.page.state = { name: 'sign-in' };
  };

  private cancel = () => {
    navigation.replace(cancelURL(this.config, this.interaction!));
  };

  private updateConsent(changes: Partial<ConsentState>) {
    let consent = this.consent;
    if (consent) {
      this.page.state = { ...consent, ...changes };
    }
  }

  private setRenew = (checked: boolean) => {
    this.updateConsent({ renew: checked });
  };

  private allow = () => this.decide('allow');

  private deny = () => this.decide('deny');

  // The answer is recorded once. Allow and Deny wait while it is, so a second
  // click sends nothing. The session that loaded the details answers for
  // them, so an answer is never given as someone who signed in since.
  private async decide(decision: 'allow' | 'deny') {
    let consent = this.consent;
    if (!consent || consent.deciding) {
      return;
    }
    this.updateConsent({ deciding: decision, error: undefined });
    let ticket: string;
    try {
      ticket = await decideConsent(
        this.config,
        consent.session,
        this.interaction!,
        { decision, renew: decision === 'allow' && consent.renew },
      );
    } catch (e: any) {
      if (e.status === 401) {
        this.page.state = { name: 'sign-in' };
        return;
      }
      if (ENDED.has(e.status)) {
        this.page.state = { name: 'ended' };
        return;
      }
      this.updateConsent({
        deciding: undefined,
        error:
          'Boxel couldn’t record your answer. Nothing was shared. Try again.',
      });
      return;
    }
    this.page.state = {
      name: 'leaving',
      outcome: decision === 'allow' ? 'allowed' : 'denied',
      details: consent.details,
    };
    navigation.replace(finishURL(this.config, this.interaction!, ticket));
  }
}
