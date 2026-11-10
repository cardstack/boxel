// A key choice drawn as a section of its own, tinted and headed by whom the
// key serves, so a key of the user's own and a key they share with a
// workspace never read alike. The section is a Pret UI Card: neutral for the
// user's own key, the info tone for a shared key, and the warning tone for a
// shared key that serves people who aren't signed in too. Its header is a
// large person or group icon and a heading of what kind of key it is and whom
// it serves, which names the section; the choice itself is the block, and
// names itself by the same two lines (`@headingId` and `@headingId`-kind).
//
// The user's own key (a `userKey` slot) serves only them: everyone else who
// uses the card chooses a key of their own. A shared key (an `apiKey` slot)
// serves the card's calls in the workspace whoever makes them; the workspace
// has one such key per slot, so approving one replaces the one chosen before.
//
// What it serves follows when the calls run (`@use`). Approved for open cards
// too, a key also serves the card's scheduled calls (any active binding serves
// an automation): the user's own key serves their scheduled calls and their use of
// the card, and a share serves everyone who uses the card in the workspace,
// their calls counting against the share's limits; where the realm's policy and
// the share's key let people who aren't signed in make the calls
// (`@anonymous`), it serves them as well. Approved for the schedule only, a key
// serves the card's scheduled calls alone: opening the card doesn't use it,
// and those calls count against no limits. With no `@use` (the use page,
// before the choice is made) it says only whose calls the key is for. A page
// that isn't approving a card's calls (sharing or swapping a key) says its own
// `@line`, and `@headline` where whom the share serves isn't known there.
import Component from '@glimmer/component';

import User from '@cardstack/boxel-icons/user';
import Users from '@cardstack/boxel-icons/users';
import HatGlasses from '@cardstack/boxel-icons/hat-glasses';
import { Card } from '@cardstack/pretui/components/card';

interface Signature {
  Args: {
    kind: 'userKey' | 'apiKey';
    use?: 'interactive' | 'automations';
    anonymous?: boolean;
    // The workspace's name, for a shared key.
    workspace?: string | null;
    // The id the headline takes; the kind line takes it with `-kind`.
    headingId: string;
    // What kind of key the section is for ("Your own key", "Shared key: …").
    label: string;
    headline?: string;
    line?: string;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

export default class KeyAudience extends Component<Signature> {
  <template>
    <Card
      class='key-audience'
      @tone={{this.tone}}
      @appearance='filled-outlined'
      aria-labelledby='{{this.kindId}} {{@headingId}}'
      data-test-key-audience={{@kind}}
      data-test-key-audience-tone={{this.tone}}
      ...attributes
    >
      <:header>
        <div class='banner'>
          <span class='disc' aria-hidden='true'>
            {{#if this.visitors}}
              <HatGlasses class='disc-icon' />
            {{else if this.shared}}
              <Users class='disc-icon' />
            {{else}}
              <User class='disc-icon' />
            {{/if}}
          </span>
          <div class='words'>
            <h2 class='heading'>
              <span
                class='eyebrow'
                id={{this.kindId}}
                data-test-key-audience-label
              >{{@label}}</span>
              <span
                class='headline'
                id={{@headingId}}
                data-test-key-audience-who
              >{{this.headline}}</span>
            </h2>
            <span class='what' data-test-key-audience-what>{{this.line}}</span>
          </div>
        </div>
      </:header>
      <:default>
        {{yield}}
      </:default>
    </Card>

    <style scoped>
      .key-audience {
        --pretui-card-pad: var(--boxel-sp);
        --key-audience-disc: var(--foreground);
        --key-audience-disc-ink: var(--background);
      }
      .key-audience[data-tone='neutral'] {
        --pretui-card-bg: color-mix(
          in oklch,
          var(--foreground) 4%,
          var(--card)
        );
      }
      .key-audience[data-tone='info'] {
        --key-audience-disc: var(--info);
        --key-audience-disc-ink: var(--info-foreground);
      }
      .key-audience[data-tone='warning'] {
        --key-audience-disc: var(--warning);
        --key-audience-disc-ink: var(--warning-foreground);
      }
      .banner {
        display: flex;
        gap: var(--boxel-sp-sm);
        align-items: flex-start;
      }
      .disc {
        flex-shrink: 0;
        display: grid;
        place-items: center;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 50%;
        background-color: var(--key-audience-disc);
        color: var(--key-audience-disc-ink);
      }
      .disc-icon {
        width: 1.25rem;
        height: 1.25rem;
      }
      .words {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        min-width: 0;
      }
      .heading {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        margin: 0;
        font: inherit;
      }
      .eyebrow {
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        font-weight: 600;
        letter-spacing: var(--boxel-lsp-lg);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .headline {
        font-size: var(--boxel-font-size-med);
        line-height: var(--boxel-line-height-med);
        font-weight: 700;
        overflow-wrap: break-word;
      }
      .what {
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
      }
    </style>
  </template>

  get kindId() {
    return `${this.args.headingId}-kind`;
  }

  private get shared() {
    return this.args.kind === 'apiKey';
  }

  private get automations() {
    return this.args.use === 'automations';
  }

  private get visitors() {
    return this.shared && !this.automations && this.args.anonymous === true;
  }

  get tone(): 'neutral' | 'info' | 'warning' {
    return this.visitors ? 'warning' : this.shared ? 'info' : 'neutral';
  }

  private get where() {
    return this.args.workspace || 'this workspace';
  }

  get headline() {
    if (this.args.headline) {
      return this.args.headline;
    }
    if (!this.shared) {
      return 'Only you';
    }
    if (this.automations) {
      return `The card’s schedule in ${this.where}`;
    }
    if (this.visitors) {
      return 'Anyone, signed in or not';
    }
    return `Everyone in ${this.where}`;
  }

  get line() {
    if (this.args.line) {
      return this.args.line;
    }
    if (!this.shared) {
      if (this.automations) {
        return 'Boxel uses this key only for the card’s scheduled calls you approve here. Opening the card doesn’t use it, and everyone else who uses the card chooses a key of their own.';
      }
      if (this.args.use === 'interactive') {
        return 'Boxel uses this key for the card’s scheduled calls and whenever you use the card. Everyone else who uses it chooses a key of their own.';
      }
      return 'Boxel uses this key only for your calls. Everyone else who uses the card chooses a key of their own.';
    }
    if (this.automations) {
      return 'Boxel uses this key only for the card’s scheduled calls in this workspace. Opening the card doesn’t use it, and scheduled calls don’t count against the share’s limits. Approving replaces any key chosen for these calls before.';
    }
    if (this.visitors) {
      return 'Boxel uses this key for the card’s scheduled calls and whenever anyone uses the card in this workspace, including people who aren’t signed in, and their calls count against the share’s limits. Approving replaces any key chosen for these calls before.';
    }
    if (this.args.use === 'interactive') {
      return 'Boxel uses this key for the card’s scheduled calls and whenever anyone uses the card in this workspace, and their calls count against the share’s limits. Approving replaces any key chosen for these calls before.';
    }
    return 'Boxel uses this key for the card’s calls in this workspace, whoever makes them.';
  }
}
