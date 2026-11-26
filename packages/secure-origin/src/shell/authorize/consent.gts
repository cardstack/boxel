// What an app connecting to Boxel asks for, and the user's answer: the app,
// the account, what the app will be able to do at each resource, whether to
// keep the connection for 30 days, and where it can be disconnected later. It
// draws only the details the provider answered (`ConsentDetails`): the app as
// the provider names it, and what the access means in Boxel's own words from
// its registry. The one value taken from the client's request is a
// confirmation code, shown only in the code's own form (`readConsentDetails`).
//
// Focus starts on the heading each time consent is drawn, never on Allow, so
// a user who presses Enter or Space as the page appears agrees to nothing.
// The heading draws no focus ring: it isn't a control, and takes focus only so
// a screen reader starts reading there.
// Allow and Deny aren't in a form, so Enter in the checkbox submits nothing.
//
// Anyone can start a flow and send a signed-in user's browser here, so a page
// can open consent in a window behind its own and uncover it under the user's
// pointer partway through a double-click. Allow takes no click until the page
// has been in view, and the window focused, for a moment, and starts waiting
// again whenever either is lost.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import AppWindow from '@cardstack/boxel-icons/app-window';
import ArrowLeftRight from '@cardstack/boxel-icons/arrow-left-right';
import Check from '@cardstack/boxel-icons/check';
import TriangleAlert from '@cardstack/boxel-icons/triangle-alert';
import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { Checkbox } from '@cardstack/pretui/components/checkbox';
import { StatusChip } from '@cardstack/pretui/components/status-chip';
import { VisuallyHidden } from '@cardstack/pretui/components/visually-hidden';
import { focusWhen } from '@cardstack/pretui/focus';

import AuthButton from '../../components/auth-button.gts';
import AuthContainer from '../../components/auth-container.gts';
import BoxelIcon from '../../components/icons/boxel-icon.gts';
import type {
  ConsentDetails,
  ConsentScope,
} from '../../security/oauth-provider.ts';

import { CONNECTED_APPS_LINE, appNameShown, renewalLine } from './copy.ts';

// How long Allow waits, once the page is in view and its window focused,
// before it takes a click.
export const ALLOW_DELAY_MS = 500;

interface Signature {
  Args: {
    details: ConsentDetails;
    // Whether "Keep this connection for 30 days" is checked.
    renew: boolean;
    // While the answer is being recorded: Allow and Deny wait.
    deciding: 'allow' | 'deny' | undefined;
    // Why the last answer wasn't recorded, when it can be given again.
    error: string | undefined;
    onRenewChange: (checked: boolean) => void;
    onAllow: () => void;
    onDeny: () => void;
    onSignOut: () => void;
    // Consent for a code typed into the device page (`device-page.gts`),
    // rather than for a flow a browser started: the warning names the code.
    device?: boolean;
  };
}

interface ScopeListSignature {
  Args: { scopes: ConsentScope[] };
}

class ScopeList extends Component<ScopeListSignature> {
  <template>
    <ul class='scopes'>
      {{#each @scopes as |scope|}}
        <li
          class='scope'
          data-test-authorize-scope={{scope.name}}
          data-test-authorize-caution={{if scope.caution 'true' 'false'}}
        >
          {{#if scope.caution}}
            <TriangleAlert class='scope-icon caution' aria-hidden='true' />
            <VisuallyHidden>Caution: </VisuallyHidden>
          {{else}}
            <Check class='scope-icon' aria-hidden='true' />
          {{/if}}
          <span>{{scope.description}}</span>
        </li>
      {{/each}}
    </ul>

    <style scoped>
      .scopes {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .scope {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
      }
      .scope-icon {
        flex-shrink: 0;
        width: 1rem;
        height: 1rem;
        margin-top: 0.125rem;
        color: var(--muted-foreground);
      }
      .caution {
        color: var(--warning);
      }
    </style>
  </template>
}

export default class Consent extends Component<Signature> {
  <template>
    <AuthContainer>
      <section class='consent' data-test-authorize-consent>
        <div class='header'>
          <div class='marks' aria-hidden='true'>
            <span class='mark'><BoxelIcon class='mark-icon boxel' /></span>
            {{#if @details.outsideApp}}
              <ArrowLeftRight class='between' />
              <span class='mark' data-test-authorize-app-icon>
                <AppWindow class='mark-icon' />
              </span>
            {{/if}}
          </div>
          <p class='account'>
            <span data-test-authorize-account>{{this.account}}</span>
            <Button
              type='button'
              class='sign-out'
              @variant='link'
              @disabled={{this.waiting}}
              {{on 'click' @onSignOut}}
              data-test-authorize-sign-out
            >Not you? Sign out</Button>
          </p>
        </div>

        <h1
          class='title'
          tabindex='-1'
          {{focusWhen true}}
          data-test-authorize-heading
        >{{this.heading}}</h1>

        {{#if this.selfRegistered}}
          <div class='unverified' data-test-authorize-unverified>
            <StatusChip
              @value='Unverified'
              @tone='warning'
              @appearance='soft'
              @dot={{false}}
            />
            <p class='note'>{{this.unverifiedNote}}</p>
          </div>
        {{else if this.ownApp}}
          <p class='note' data-test-authorize-own-app>Boxel’s own app.</p>
        {{/if}}

        {{#if this.onThisComputer}}
          <section class='confirm' data-test-authorize-confirmation>
            {{#if @details.confirmationCode}}
              <p class='lead'>Check that {{this.name}} shows this code:</p>
              <p
                class='code'
                data-test-authorize-confirmation-code
              >{{@details.confirmationCode}}</p>
            {{/if}}
            <Alert @tone='warning' data-test-authorize-confirmation-warning>
              {{this.confirmationWarning}}
            </Alert>
          </section>
        {{/if}}

        {{#if this.oneResource}}
          <section
            class='resource'
            data-test-authorize-resource={{this.oneResource.id}}
          >
            <p class='lead'>{{this.name}} will be able to:</p>
            <ScopeList @scopes={{this.oneResource.scopes}} />
            <p class='coverage' data-test-authorize-coverage>
              {{this.oneResource.coverage}}
            </p>
          </section>
        {{else}}
          {{#each @details.resources as |resource|}}
            <section
              class='resource'
              data-test-authorize-resource={{resource.id}}
            >
              <h2 class='resource-name'>{{resource.name}}</h2>
              <ScopeList @scopes={{resource.scopes}} />
              <p class='coverage' data-test-authorize-coverage>
                {{resource.coverage}}
              </p>
            </section>
          {{/each}}
        {{/if}}

        {{#if @details.outsideApp}}
          <p class='terms' data-test-authorize-terms>Once shared,
            {{this.name}}’s use of your data is governed by its own terms and
            privacy policy, not Boxel’s.</p>
        {{/if}}

        <div class='renewal'>
          {{#if @details.renewalOffered}}
            <Checkbox
              @label='Keep this connection for 30 days'
              @checked={{@renew}}
              @onCheckedChange={{@onRenewChange}}
              data-test-authorize-renew
            />
          {{/if}}
          {{#if this.expiry}}
            <p class='expiry' data-test-authorize-expiry>{{this.expiry}}</p>
          {{/if}}
          <p
            class='connected-apps'
            data-test-authorize-connected-apps
          >{{CONNECTED_APPS_LINE}}</p>
        </div>

        {{#if @error}}
          <Alert @tone='danger' data-test-authorize-error>{{@error}}</Alert>
        {{/if}}

        <div class='actions'>
          <AuthButton
            type='button'
            @variant='secondary'
            @disabled={{this.waiting}}
            @loading={{this.denying}}
            {{on 'click' @onDeny}}
            data-test-authorize-deny
          >Deny</AuthButton>
          <AuthButton
            type='button'
            @variant='primary'
            @disabled={{this.allowHeld}}
            @loading={{this.allowing}}
            {{on 'click' @onAllow}}
            data-test-authorize-allow
          >Allow</AuthButton>
        </div>
      </section>
    </AuthContainer>

    <style scoped>
      .consent {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        color: var(--foreground);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
      }
      .marks {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .mark {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 2.5rem;
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--background);
      }
      .mark-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--foreground);
      }
      .boxel {
        --icon-color: var(--boxel-highlight);
      }
      .between {
        width: 1rem;
        height: 1rem;
        color: var(--muted-foreground);
      }
      .account {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--boxel-sp-3xs);
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        overflow-wrap: anywhere;
      }
      .sign-out {
        --pretui-button-fg: var(
          --boxel-button-link-primary-foreground,
          var(--primary)
        );
        min-height: 0;
        padding-block: 0;
        border: 0;
        font-size: inherit;
        line-height: inherit;
      }
      .title {
        margin: 0;
        padding: 0;
        font-size: var(--boxel-font-size-md);
        font-weight: 600;
        line-height: var(--boxel-line-height-md);
        overflow-wrap: anywhere;
      }
      .title:focus {
        outline: none;
      }
      .unverified {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
      }
      .note,
      .lead,
      .coverage,
      .terms,
      .expiry,
      .connected-apps {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .note,
      .coverage,
      .terms,
      .expiry,
      .connected-apps {
        color: var(--muted-foreground);
      }
      .confirm {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .code {
        margin: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--muted);
        color: var(--foreground);
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-lg);
        font-weight: 600;
        line-height: var(--boxel-line-height-lg);
        letter-spacing: var(--boxel-lsp-xl);
        text-align: center;
      }
      .resource {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .resource-name {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        line-height: var(--boxel-line-height-sm);
      }
      .renewal {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      .expiry,
      .connected-apps {
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
      }
      .actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-sm);
        margin-top: var(--boxel-sp-xs);
      }
    </style>
  </template>

  private guard = trackedObject({ ready: false });
  private readyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    window.addEventListener('focus', this.wait);
    window.addEventListener('blur', this.wait);
    document.addEventListener('visibilitychange', this.wait);
    this.wait();
  }

  willDestroy() {
    super.willDestroy();
    clearTimeout(this.readyTimer);
    window.removeEventListener('focus', this.wait);
    window.removeEventListener('blur', this.wait);
    document.removeEventListener('visibilitychange', this.wait);
  }

  // Holds Allow back, and lets it go only once the page has been in view,
  // and its window focused, for ALLOW_DELAY_MS.
  private wait = () => {
    this.guard.ready = false;
    clearTimeout(this.readyTimer);
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      this.readyTimer = setTimeout(() => {
        this.guard.ready = true;
      }, ALLOW_DELAY_MS);
    }
  };

  private get allowHeld(): boolean {
    return this.waiting || !this.guard.ready;
  }

  private get account(): string {
    let account = this.args.details.account;
    return 'email' in account ? account.email : account.displayName;
  }

  // The app as the page names it: the name a client that registered itself
  // gave, quoted, or else the name Boxel can check.
  private get name(): string {
    return appNameShown(this.args.details.app);
  }

  private get selfRegistered(): boolean {
    return this.args.details.app.kind === 'dynamic';
  }

  private get ownApp(): boolean {
    return this.args.details.app.kind === 'pre-registered';
  }

  // A pre-registered app on the user's own computer: any program there can
  // ask as it, so the page asks the user to check they started this.
  private get onThisComputer(): boolean {
    return this.ownApp && this.args.details.app.place === 'this-computer';
  }

  private get confirmationWarning(): string {
    if (this.args.device) {
      return `Only allow this if you typed a code shown in your own terminal, where you just started signing in to ${this.name}. If someone sent you this code, choose Deny.`;
    }
    let matches = this.args.details.confirmationCode
      ? ' and it shows this code'
      : '';
    return `Only allow this if you just started signing in from ${this.name}${matches}. If someone sent you this link, or asks you to copy the address you land on, choose Deny.`;
  }

  private get oneResource() {
    let { resources } = this.args.details;
    return resources.length === 1 ? resources[0] : undefined;
  }

  private get heading(): string {
    let to = this.oneResource?.name ?? 'Boxel';
    return `Connect ${this.name} to ${to}?`;
  }

  private get unverifiedNote(): string {
    let { claimedName, shown } = this.args.details.app;
    return claimedName
      ? `This app named itself ${this.name}. Boxel can’t confirm who made it. It will return to: ${shown}`
      : `Boxel can’t confirm who made this app. It will return to: ${shown}`;
  }

  private get expiry(): string | undefined {
    return renewalLine(this.args.details.renewalOffered && this.args.renew);
  }

  private get waiting(): boolean {
    return this.args.deciding !== undefined;
  }

  private get allowing(): boolean {
    return this.args.deciding === 'allow';
  }

  private get denying(): boolean {
    return this.args.deciding === 'deny';
  }
}
