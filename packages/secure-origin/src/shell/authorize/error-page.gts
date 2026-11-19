// The authorize page's error page (ADR 021 §1.8): what the page shows when the
// provider refused a flow before consent, at `authorize?error=<value>`.
//
// Each state says what went wrong in fixed words, with Close. "Return to
// <app>" is drawn only where the realm server offers it, and links to the
// realm-server route that sends the browser back to the app; the page never
// sends the browser anywhere itself. Everything the page shows comes from the
// realm server's answer for a reference (`oauth-errors.ts`), never from its
// own address.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import AuthButton from '../../components/auth-button.gts';
import AuthContainer from '../../components/auth-container.gts';
import BusyMessage from '../../components/busy-message.gts';
import {
  ErrorDetailsFailure,
  errorReturnURL,
  parseErrorParam,
  readAuthorizationError,
  type ErrorApp,
  type ErrorState,
} from '../../security/oauth-errors.ts';
import type { PageVisit } from '../../telemetry/instrument.ts';
import { navigation } from '../navigation.js';
import MessagePage from '../sign-in/message-page.gts';

import {
  CLOSE_HINT,
  errorCopy,
  returnLabel,
  type ErrorPageState,
} from './error-copy.ts';

interface Signature {
  Args: {
    config: { realmServerURL: URL };
    // How the page's load ended, for the telemetry.
    visit: PageVisit;
  };
}

// Each state is replaced whole, never changed in place, so the page redraws.
type State =
  | { name: 'loading' }
  | { name: 'shown'; state: ErrorState; app?: ErrorApp; returnTo?: string }
  | { name: 'failed'; retryable: boolean };

export default class ErrorPage extends Component<Signature> {
  <template>
    {{#if this.shownState}}
      <div class='error-page' data-test-oauth-error={{this.shownState}}>
        <MessagePage
          @heading={{this.copy.heading}}
          @info={{this.copy.info}}
          @focus={{true}}
        >
          <div class='actions'>
            {{#if this.returnTo}}
              <AuthButton
                class='return'
                @href={{this.returnTo}}
                @variant='primary'
                data-test-oauth-error-return
              >{{this.returnText}}</AuthButton>
            {{/if}}
            {{#if this.retryable}}
              <AuthButton
                type='button'
                @variant='primary'
                {{on 'click' this.retry}}
                data-test-oauth-error-retry
              >Try again</AuthButton>
            {{/if}}
            <AuthButton
              type='button'
              @variant='secondary'
              {{on 'click' this.close}}
              data-test-oauth-error-close
            >Close</AuthButton>
          </div>
          {{! In the page from the start, so a screen reader announces the
              line when it is filled in. }}
          <p class='hint' role='status' data-test-oauth-error-close-hint>{{if
              this.closeTried
              CLOSE_HINT
            }}</p>
        </MessagePage>
      </div>
    {{else}}
      <AuthContainer>
        <BusyMessage @title='Loading…' data-test-oauth-error-loading />
      </AuthContainer>
    {{/if}}

    <style scoped>
      .error-page {
        display: contents;
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp-sm);
      }
      /* The app's name comes from the server and can be long, so the label
         wraps rather than running out of the button. */
      .return {
        white-space: normal;
        overflow-wrap: anywhere;
        text-align: center;
      }
      .hint {
        margin: var(--boxel-sp-sm) 0 0;
        letter-spacing: var(--boxel-lsp);
      }
      /* Kept in the page while empty, out of the layout's way. */
      .hint:empty {
        margin: 0;
      }
    </style>
  </template>

  private param = parseErrorParam(window.location.search);
  private page = trackedObject<{ state: State; closeTried: boolean }>({
    state: { name: 'loading' },
    closeTried: false,
  });
  // The lookup in flight, stopped when another starts or the page goes.
  private lookup: AbortController | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    window.addEventListener('pageshow', this.shown);
    if (this.param.kind === 'ref') {
      this.load(this.param.ref);
      return;
    }
    // A fixed value, or one the server never sends, which is shown as an
    // expired request without asking anything.
    this.page.state = {
      name: 'shown',
      state: this.param.kind === 'fixed' ? this.param.state : 'expired',
    };
    this.args.visit.loaded();
  }

  willDestroy() {
    super.willDestroy();
    window.removeEventListener('pageshow', this.shown);
    this.lookup?.abort();
  }

  // Back from the app can bring this page back as it was left, from the
  // browser's cache, with "Return" spent. The reference is looked up again,
  // so a spent one shows as expired.
  private shown = (event: PageTransitionEvent) => {
    if (event.persisted && this.param.kind === 'ref') {
      this.load(this.param.ref);
    }
  };

  private async load(ref: string) {
    this.lookup?.abort();
    let lookup = new AbortController();
    this.lookup = lookup;
    this.page.state = { name: 'loading' };
    try {
      let details = await readAuthorizationError(
        this.args.config.realmServerURL,
        ref,
        { signal: lookup.signal },
      );
      if (lookup.signal.aborted) {
        return;
      }
      this.page.state = {
        name: 'shown',
        state: details.state,
        ...(details.app ? { app: details.app } : {}),
        ...(details.returnOffered
          ? { returnTo: errorReturnURL(this.args.config.realmServerURL, ref) }
          : {}),
      };
      this.args.visit.loaded();
    } catch (e) {
      if (lookup.signal.aborted) {
        return;
      }
      this.page.state = {
        name: 'failed',
        retryable: e instanceof ErrorDetailsFailure && e.retryable,
      };
      this.args.visit.loadFailed(e);
    }
  }

  private get shownState(): ErrorPageState | undefined {
    let state = this.page.state;
    switch (state.name) {
      case 'shown':
        return state.state;
      case 'failed':
        return 'load-failed';
      default:
        return undefined;
    }
  }

  private get copy() {
    let state = this.page.state;
    return errorCopy(this.shownState ?? 'load-failed', {
      ...(state.name === 'shown' && state.app ? { app: state.app } : {}),
      retryable: this.retryable,
    });
  }

  private get returnTo(): string | undefined {
    let state = this.page.state;
    return state.name === 'shown' ? state.returnTo : undefined;
  }

  private get returnText(): string {
    let state = this.page.state;
    return state.name === 'shown' && state.app ? returnLabel(state.app) : '';
  }

  private get retryable(): boolean {
    let state = this.page.state;
    return state.name === 'failed' && state.retryable;
  }

  private get closeTried(): boolean {
    return this.page.closeTried;
  }

  private retry = () => {
    if (this.param.kind === 'ref') {
      this.load(this.param.ref);
    }
  };

  // A window the app opened, or the user did, can't be closed by script, so
  // when it stays open the page says it can be closed by hand.
  private close = () => {
    navigation.close();
    this.page.closeTried = true;
  };
}
