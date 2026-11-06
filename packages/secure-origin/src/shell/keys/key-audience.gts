// A key choice drawn as a section of its own, tinted and headed by whom the
// key serves, so a key of the user's own and a key they share with a
// workspace never read alike. The section is a Pret UI Card: neutral for the
// user's own key, the info tone for a shared key, and the warning tone for a
// shared key that serves people who aren't signed in too. Its header is a
// large person or group icon, what kind of key it is, and whom it serves; the
// choice itself is the block.
//
// The user's own key (a `userKey` slot) serves only them: everyone else who
// uses the card chooses a key of their own. A shared key (an `apiKey` slot)
// serves the card's calls in the workspace whoever makes them; the workspace
// has one such key per slot, so approving one replaces the one chosen before.
//
// What it serves follows when the calls run (`@use`). Approved for open cards
// too, a share serves everyone who uses the card in the workspace, and their
// calls count against the share's limits; where the realm's policy and the
// share's key let people who aren't signed in make the calls (`@anonymous`),
// it serves them as well. Approved for the schedule only, a key serves the
// card's scheduled calls alone: opening the card doesn't use it, and those
// calls count against no limits. With no `@use` (the use page, before the
// choice is made) it says only whose calls the key is for.
import Component from '@glimmer/component';

import User from '@cardstack/boxel-icons/user';
import Users from '@cardstack/boxel-icons/users';
import { Card } from '@cardstack/pretui/components/card';

interface Signature {
  Args: {
    kind: 'userKey' | 'apiKey';
    use?: 'interactive' | 'pipelines';
    anonymous?: boolean;
    // The workspace's name, for a shared key.
    workspace?: string | null;
    // The id the headline takes, so the choice inside can be named by it.
    headingId: string;
    // What kind of key the section is for ("Your own key", "Shared key: …").
    label: string;
    // What the section says in place of its own line, for a page that isn't
    // approving a card's calls (sharing or swapping a key).
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
      data-test-key-audience={{@kind}}
      data-test-key-audience-tone={{this.tone}}
      ...attributes
    >
      <:header>
        <div class='banner'>
          <span class='disc' aria-hidden='true'>
            {{#if this.shared}}
              <Users class='disc-icon' />
            {{else}}
              <User class='disc-icon' />
            {{/if}}
          </span>
          <div class='words'>
            <span class='eyebrow' data-test-key-audience-label>{{@label}}</span>
            <span
              class='headline'
              id={{@headingId}}
              data-test-key-audience-who
            >{{this.headline}}</span>
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
      }
      .key-audience[data-test-key-audience-tone='neutral'] {
        --pretui-card-bg: color-mix(
          in oklch,
          var(--foreground) 4%,
          var(--card)
        );
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
        background-color: var(--pretui-tone, var(--muted-foreground));
        color: var(--pretui-tone-on, var(--background));
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
        overflow-wrap: anywhere;
      }
      .what {
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
      }
    </style>
  </template>

  private get shared() {
    return this.args.kind === 'apiKey';
  }

  private get pipelines() {
    return this.args.use === 'pipelines';
  }

  private get visitors() {
    return this.shared && !this.pipelines && this.args.anonymous === true;
  }

  get tone(): 'neutral' | 'info' | 'warning' {
    return this.visitors ? 'warning' : this.shared ? 'info' : 'neutral';
  }

  private get where() {
    return this.args.workspace || 'this workspace';
  }

  get headline() {
    if (!this.shared) {
      return 'Only you';
    }
    if (this.pipelines) {
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
      if (this.pipelines) {
        return 'Boxel uses this key only for the card’s scheduled calls you approve here. Opening the card doesn’t use it, and everyone else who uses the card chooses a key of their own.';
      }
      if (this.args.use === 'interactive') {
        return 'Boxel uses this key only when you use the card. Everyone else who uses it chooses a key of their own.';
      }
      return 'Boxel uses this key only for your use of the card. Everyone else who uses it chooses a key of their own.';
    }
    if (this.pipelines) {
      return 'Boxel uses this key only for the card’s scheduled calls in this workspace. Opening the card doesn’t use it, and scheduled calls don’t count against the share’s limits. Approving replaces any key chosen for these calls before.';
    }
    if (this.visitors) {
      return 'Boxel uses this key whenever anyone uses the card in this workspace, including people who aren’t signed in, and their calls count against the share’s limits. Approving replaces any key chosen for these calls before.';
    }
    if (this.args.use === 'interactive') {
      return 'Boxel uses this key whenever anyone uses the card in this workspace, and their calls count against the share’s limits. Approving replaces any key chosen for these calls before.';
    }
    return 'Boxel uses this key for the card’s calls in this workspace, whoever makes them, in place of any key chosen for those calls before.';
  }
}
