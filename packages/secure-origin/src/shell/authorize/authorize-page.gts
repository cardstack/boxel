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
// and the page shows the error page (`error-page.gts`); it never starts
// consent for it. An address whose interaction ID isn't one shows that the
// request can't continue, without asking the realm server anything.
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
import ErrorPage from './error-page.gts';
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
  // `returned`: back to a sign-in from consent, so the heading takes focus,
  // and `ended` says the session ended before the answer was recorded.
  | { name: 'sign-in'; returned?: 'not-you' | 'ended' }
  | { name: 'loading' }
  | { name: 'unavailable' }
  | ConsentState
  | { name: 'leaving'; outcome: 'allowed' | 'denied'; details: ConsentDetails }
  | { name: 'ended' }
  | { name: 'error' };

// A refusal that means the flow can't be answered here any more: it expired,
// was already answered, or the request was never one the provider would take.
// The page tells the app nothing then: an expired flow can't be finished, and
// one answered elsewhere is finished by the window that answered it.
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
          @focusTitle={{this.signInReturned}}
        >
          <:intro>
            {{#if this.sessionEnded}}
              <p
                data-test-authorize-sign-in-intro
                data-test-authorize-session-ended
              >Your sign-in ended before your answer was recorded. Sign in again
                to answer.</p>
            {{else}}
              <p data-test-authorize-sign-in-intro>You’ll see which app and what
                it can do on the next step.</p>
            {{/if}}
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
    {{else if (this.is 'error')}}
      <ErrorPage @config={{this.config}} @visit={{this.visit}} />
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
  // Which of the page's runs may still change its state. Each start, sign-in
  // and "Not you?" begins a new run, so a load or an answer that a newer one
  // overtook writes nothing.
  private run = 0;

  constructor(owner: Owner, args: object) {
    super(owner, args);
    window.addEventListener('pageshow', this.shown);
    if (this.request.kind === 'consent') {
      this.start();
    } else if (this.request.kind === 'error') {
      // The error page reports how its load ended.
      this.page.state = { name: 'error' };
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

  private get signInReturned(): boolean {
    let state = this.page.state;
    return state.name === 'sign-in' && Boolean(state.returned);
  }

  private get sessionEnded(): boolean {
    let state = this.page.state;
    return state.name === 'sign-in' && state.returned === 'ended';
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
    let run = ++this.run;
    this.page.state = { name: 'checking' };
    let session = await liveSession(this.config);
    if (run !== this.run) {
      return;
    }
    if (!session) {
      this.page.state = { name: 'sign-in' };
      this.visit.signedOut();
      return;
    }
    await this.load(session, run);
  }

  private async load(session: Session, run: number, retried = false) {
    let interaction = this.interaction!;
    this.page.state = { name: 'loading' };
    let details: ConsentDetails;
    try {
      details = await consentDetails(this.config, session, interaction);
    } catch (e: any) {
      if (run !== this.run) {
        return;
      }
      if (e.status === 401) {
        // The server's clock can end the session before this window's does;
        // one bound to the app's session is renewed then, once.
        let renewed = retried ? undefined : await liveSession(this.config);
        if (run !== this.run) {
          return;
        }
        if (renewed && renewed.token !== session.token) {
          await this.load(renewed, run, true);
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
    if (run !== this.run) {
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
    this.load(session, ++this.run);
  };

  // "Not you?": the session consent was shown under ends, here and on the
  // server, and the same flow asks for a sign-in again at once. Consent goes
  // first, and an answer still being sent goes no further, so nothing can be
  // answered as the account just disowned while the server ends its session.
  // It is the session shown that ends, even when another of the origin's
  // windows has stored a newer one since.
  private notYou = () => {
    let consent = this.consent;
    this.run++;
    this.page.state = { name: 'sign-in', returned: 'not-you' };
    signOut(this.config, consent?.session).catch(() => {
      // Forgotten here whatever the server answers.
    });
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
  // them, so an answer is never given as someone who signed in since; when
  // the server's clock has ended it, it is renewed once, as a load does.
  //
  // The provider answers the same decision sent again with a new ticket, so
  // Try again after a reply that never arrived still finishes the flow.
  private async decide(decision: 'allow' | 'deny') {
    let consent = this.consent;
    if (!consent || consent.deciding) {
      return;
    }
    let run = this.run;
    this.updateConsent({ deciding: decision, error: undefined });
    let answer = { decision, renew: decision === 'allow' && consent.renew };
    let session = consent.session;
    let ticket: string | undefined;
    for (let retried = false; !ticket; retried = true) {
      try {
        ticket = await decideConsent(
          this.config,
          session,
          this.interaction!,
          answer,
        );
      } catch (e: any) {
        if (run !== this.run) {
          return;
        }
        if (e.status === 401 && !retried) {
          let renewed = await liveSession(this.config);
          if (run !== this.run) {
            return;
          }
          if (renewed && renewed.token !== session.token) {
            session = renewed;
            this.updateConsent({ session });
            continue;
          }
        }
        if (e.status === 401) {
          this.run++;
          this.page.state = { name: 'sign-in', returned: 'ended' };
          return;
        }
        if (ENDED.has(e.status)) {
          this.page.state = { name: 'ended' };
          return;
        }
        this.updateConsent({
          deciding: undefined,
          error: 'Boxel couldn’t confirm your answer. Try again.',
        });
        return;
      }
    }
    // Signed out, or started again, meanwhile: the page has moved on, and the
    // answer goes no further.
    if (run !== this.run) {
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
