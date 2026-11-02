// The `keys/<key id>/use` page: one of the user's keys set up for a card
// before the card asks for it. It asks which workspace (one the user can read
// by a permission of their own) and which card definition there, among those
// the workspace's cards adopt from that send the user's own key in a request,
// then goes on to the approve page for that card and workspace with this key
// chosen. That page approves exactly as one opened by the card would, and
// comes back to the key page when done.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  listKeys,
  readableRealms,
  realmCardsWithRequests,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import FieldContainer from '../../components/field-container.gts';
import KeyRound from '../../components/icons/key-round.gts';
import LayoutGrid from '../../components/icons/layout-grid.gts';
import RectangleEllipsis from '../../components/icons/rectangle-ellipsis.gts';
import RadioTile from '../../components/radio-tile.gts';
import { eq } from '../../helpers/truth-helpers.ts';
import { navigation } from '../navigation.js';
import { pageURL } from '../urls.js';

import {
  failureMessage,
  isSignedOut,
  LinkError,
  loadFailure,
  type LoadFailure,
} from './context.ts';
import type { UserKey } from './context.ts';
import EditPage from './edit-page.gts';
import KeyTile from './key-tile.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import WorkspaceDropdown from './workspace-dropdown.gts';

interface Card {
  module: string;
  name: string;
  displayName: string;
}

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; failure: LoadFailure }
  | { name: 'choosing'; key: UserKey };

class UseKey extends Component<{
  Args: { api: KeysWindowAPI; keyId: string };
}> {
  <template>
    {{#if this.loading}}
      <BusyMessage class='busy' @title='Loading…' />
    {{else if this.loadFailed}}
      <LoadFailed
        @heading='Use a key with a card'
        @failure={{this.loadFailed.failure}}
        @onRetry={{this.load}}
      />
    {{else if this.choosing}}
      <form novalidate {{on 'submit' this.next}} data-test-use-key-form>
        <EditPage @heading='Use a key with a card' data-test-use-key>
          <:intro>Choose a workspace and a card there. Next you’ll see every
            request the card makes with your key, and approve them once.</:intro>
          <:default>
            <FieldContainer @tag='div' @label='Key' @icon={{KeyRound}}>
              <KeyTile @key={{this.choosing.key}} />
            </FieldContainer>
            <FieldContainer
              @tag='div'
              @label='Workspace'
              @icon={{LayoutGrid}}
              data-test-use-key-realm
              as |labelId|
            >
              <WorkspaceDropdown
                @workspaces={{this.form.realms}}
                @selected={{this.form.realm}}
                @onSelect={{this.selectRealm}}
                @labelId={{labelId}}
              />
            </FieldContainer>
            {{#if this.form.realm}}
              <FieldContainer
                @tag='div'
                @label='Card'
                @icon={{RectangleEllipsis}}
                data-test-use-key-cards
              >
                {{#if this.form.loadingCards}}
                  <BusyMessage @title='Loading…' />
                {{else}}
                  <fieldset class='cards'>
                    <legend class='visually-hidden'>Card</legend>
                    {{#each this.form.cards as |card|}}
                      <RadioTile
                        @name='card'
                        @checked={{eq this.form.card card}}
                        @onChange={{this.selectCard card}}
                        data-test-use-key-card={{card.name}}
                      >
                        <span class='card-name'>{{card.displayName}}</span>
                      </RadioTile>
                    {{else}}
                      <p class='empty' data-test-use-key-no-cards>No card in
                        this workspace sends a key of yours in a request.</p>
                    {{/each}}
                  </fieldset>
                {{/if}}
              </FieldContainer>
            {{/if}}
            {{#if this.form.error}}
              <div class='keys-error' role='alert' data-test-keys-error>
                {{this.form.error}}
              </div>
            {{/if}}
          </:default>
          <:actions>
            <Button
              type='button'
              @kind='secondary'
              data-test-use-key-cancel
              {{on 'click' this.goToKeys}}
            >Cancel</Button>
            <Button
              type='submit'
              @kind='primary'
              @disabled={{this.nextDisabled}}
              data-test-use-key-next
            >Next</Button>
          </:actions>
        </EditPage>
      </form>
    {{/if}}

    <style scoped>
      form {
        display: flex;
        flex-direction: column;
        flex: 1;
      }
      .busy {
        margin-top: var(--boxel-sp-xl);
      }
      .cards {
        margin: 0;
        padding: 0;
        border: 0;
        display: grid;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .card-name {
        display: block;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .empty {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
      }
      .keys-error {
        color: var(--destructive-ink, var(--boxel-danger));
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        font-weight: 500;
      }
    </style>
  </template>

  private page = trackedObject<{ state: State }>({
    state: { name: 'loading' },
  });
  private form = trackedObject({
    realms: [] as { url: string; name: string }[],
    realm: undefined as string | undefined,
    cards: [] as Card[],
    card: undefined as Card | undefined,
    loadingCards: false,
    error: undefined as string | undefined,
  });

  constructor(owner: Owner, args: { api: KeysWindowAPI; keyId: string }) {
    super(owner, args);
    this.load();
  }

  private get loading() {
    return this.page.state.name === 'loading';
  }
  private get loadFailed() {
    return this.page.state.name === 'load-failed' ? this.page.state : undefined;
  }
  private get choosing() {
    return this.page.state.name === 'choosing' ? this.page.state : undefined;
  }
  private get nextDisabled() {
    return !this.form.realm || !this.form.card;
  }

  private load = async () => {
    this.page.state = { name: 'loading' };
    let { config } = this.args.api;
    try {
      let [keys, realms] = await Promise.all([
        listKeys(config),
        readableRealms(config),
      ]);
      let key = keys.find((k) => k.id === this.args.keyId);
      if (!key) {
        throw new LinkError(
          'the key this page names isn’t one of your keys',
          'This key isn’t one of yours. It may have been deleted.',
        );
      }
      this.form.realms = realms;
      this.page.state = { name: 'choosing', key };
      this.args.api.visit.loaded();
      if (realms.length === 1) {
        this.selectRealm(realms[0]!.url);
      }
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      } else {
        this.args.api.visit.loadFailed(e);
        this.page.state = { name: 'load-failed', failure: loadFailure(e) };
      }
    }
  };

  private selectRealm = async (url: string) => {
    this.form.realm = url;
    this.form.card = undefined;
    this.form.cards = [];
    this.form.error = undefined;
    this.form.loadingCards = true;
    try {
      let cards = await realmCardsWithRequests(this.args.api.config, url);
      if (this.form.realm === url) {
        this.form.cards = cards;
        if (cards.length === 1) {
          this.form.card = cards[0];
        }
      }
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
      // A workspace the user has moved on from says nothing about this one.
      if (this.form.realm === url) {
        this.form.error = failureMessage(e);
      }
    } finally {
      if (this.form.realm === url) {
        this.form.loadingCards = false;
      }
    }
  };

  private selectCard = (card: Card) => () => {
    this.form.card = card;
  };

  private goToKeys = () => navigation.back(pageURL('keys'));

  // The approve page reads what it is for from its fragment, so it loads as a
  // document of its own.
  private next = (event: Event) => {
    event.preventDefault();
    let { realm, card } = this.form;
    if (!realm || !card) {
      return;
    }
    let fragment = new URLSearchParams({
      module: card.module,
      name: card.name,
      realm,
      key: this.args.keyId,
      then: 'keys',
    });
    navigation.assign(`${pageURL('approve')}#${fragment}`);
  };
}

export default class UseKeyPage extends Component<{ Args: { keyId: string } }> {
  <template>
    <KeysWindow @title='Boxel · Your keys' @page='use-key' as |api|>
      <UseKey @api={{api}} @keyId={{@keyId}} />
    </KeysWindow>
  </template>
}
