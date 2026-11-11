// The `keys/<key id>/use` page: one of the user's keys set up for a card
// before the card asks for it. It asks which workspace (one the user can read
// by a permission of their own) and which card definition there, among those
// the workspace's cards adopt from that send the user's own key in a request,
// then goes on to the approve page for that card and workspace with this key
// chosen. That page approves exactly as one opened by the card would, and
// comes back to the key page when done.
//
// Opened for one of the key's shares (`#realm=<realm>&share=<share id>`), it
// sets that share up instead: the workspace is the share's, the cards are
// those that send the workspace's key, and the approve page starts with the
// share chosen.
//
// Either way it says whom the key will serve, as the approve page does: the
// user alone for their own key, everyone in the workspace for a share.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  listKeys,
  readableRealms,
  realmCardsWithRequests,
  type SharedWorkspace,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import { Button } from '@cardstack/pretui/components/button';
import { Field } from '@cardstack/pretui/components/field';
import { RadioCard } from '@cardstack/pretui/components/radio-card';
import { Alert } from '@cardstack/pretui/components/alert';
import LayoutGrid from '@cardstack/boxel-icons/layout-grid';
import RectangleEllipsis from '@cardstack/boxel-icons/rectangle-ellipsis';
import { navigation } from '../navigation.js';
import { keyUsePath } from '../pages.js';
import { pageURL } from '../urls.js';
import { keyPageURL, pageTitle, withWayBack } from './trail.ts';

import {
  failureMessage,
  isSignedOut,
  LinkError,
  loadFailure,
  type LoadFailure,
} from './context.ts';
import type { UserKey } from './context.ts';
import EditPage from './edit-page.gts';
import KeyAudience from './key-audience.gts';
import KeyTile from './key-tile.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import { openedFor } from './opened-for.ts';
import WorkspacePicker from './workspace-picker.gts';
import { addressOf } from './workspaces.ts';

interface Card {
  module: string;
  name: string;
  displayName: string;
}

// The share the page sets up, when it is opened for one, with the workspace
// it is in.
interface ForShare {
  id: string;
  label: string;
  workspace: SharedWorkspace;
}

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; failure: LoadFailure }
  | { name: 'choosing'; key: UserKey; share: ForShare | undefined };

class UseKey extends Component<{
  Args: { api: KeysWindowAPI; keyId: string };
}> {
  <template>
    {{#if this.loading}}
      <BusyMessage class='busy' @title='Loading…' />
    {{else if this.loadFailed}}
      <LoadFailed
        @heading={{this.title}}
        @failure={{this.loadFailed.failure}}
        @onRetry={{this.load}}
      />
    {{else if this.choosing}}
      <form
        novalidate
        data-form-type='other'
        {{on 'submit' this.next}}
        data-test-use-key-form
      >
        <EditPage @heading={{this.title}} data-test-use-key>
          <:intro>
            {{#if this.choosing.share}}
              Choose a card in this workspace. Next you’ll see every call the
              card makes with the key you shared as
              <strong>“{{this.choosing.share.label}}”</strong>, and approve them
              once.
            {{else}}
              Choose a workspace and a card there. Next you’ll see every call
              the card makes with your own key, and approve them once.
            {{/if}}
          </:intro>
          <:default>
            <KeyAudience
              @kind={{if this.choosing.share 'apiKey' 'userKey'}}
              @label={{if this.choosing.share 'Shared key' 'Your own key'}}
              @workspace={{this.choosing.share.workspace.name}}
              @headingId='use-key-audience'
              data-test-use-key-audience
            >
              <KeyTile
                @key={{this.choosing.key}}
                @shared={{if this.choosing.share true false}}
              />
            </KeyAudience>
            {{#if this.choosing.share}}
              <Field
                @reserveMessage={{false}}
                @orientation='horizontal'
                @labelTag='span'
                @label='Workspace'
                @icon={{LayoutGrid}}
                data-test-use-key-share-realm
              >
                <p class='workspace'>
                  {{#if this.choosing.share.workspace.name}}
                    <span
                      class='workspace-name'
                    >{{this.choosing.share.workspace.name}}</span>
                  {{/if}}
                  <span class='address'>{{addressOf
                      this.choosing.share.workspace.url
                    }}</span>
                </p>
              </Field>
            {{else}}
              <Field
                @reserveMessage={{false}}
                @orientation='horizontal'
                @labelTag='span'
                @label='Workspace'
                @icon={{LayoutGrid}}
                data-test-use-key-realm
                as |_controlId _messageId labelId|
              >
                <WorkspacePicker
                  @workspaces={{this.form.realms}}
                  @selected={{this.form.realm}}
                  @onSelect={{this.selectRealm}}
                  @labelId={{labelId}}
                  @emptyMessage='You don’t have access to any workspace to use this key in.'
                />
              </Field>
            {{/if}}
            {{#if this.form.realm}}
              <Field
                @reserveMessage={{false}}
                @orientation='horizontal'
                @labelTag='span'
                @label='Card'
                @icon={{RectangleEllipsis}}
                data-test-use-key-cards
                as |_controlId _messageId labelId|
              >
                {{#if this.form.loadingCards}}
                  <BusyMessage @title='Loading…' />
                {{else}}
                  {{#if this.form.cards.length}}
                    <RadioCard
                      class='cards'
                      @name='card'
                      @options={{this.cardChoices}}
                      @value={{this.chosenCard}}
                      @onValueChange={{this.selectCard}}
                      aria-labelledby={{labelId}}
                      as |choice|
                    >
                      <span
                        class='card-name'
                        data-test-use-key-card={{this.cardNameOf choice.value}}
                      >{{choice.title}}</span>
                    </RadioCard>
                  {{else}}
                    <p class='empty' data-test-use-key-no-cards>
                      {{#if this.choosing.share}}
                        No card in this workspace sends the workspace’s key in a
                        request this key works for.
                      {{else}}
                        No card in this workspace makes a request this key works
                        for.
                      {{/if}}
                    </p>
                  {{/if}}
                {{/if}}
              </Field>
            {{/if}}
            {{#if this.form.error}}
              <Alert @tone='danger' role='alert'>
                <span data-test-keys-error>{{this.form.error}}</span>
              </Alert>
            {{/if}}
          </:default>
          <:actions>
            <Button
              type='button'
              @variant='secondary'
              data-test-use-key-cancel
              {{on 'click' this.goToKeys}}
            >Cancel</Button>
            <Button
              type='submit'
              @variant='primary'
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
        gap: var(--boxel-sp-xs);
      }
      .workspace {
        display: grid;
        margin: 0;
        overflow-wrap: anywhere;
      }
      .workspace-name {
        font-weight: 600;
      }
      .address {
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
      .card-name {
        display: block;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .empty {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
      }
    </style>
  </template>

  private title = pageTitle(keyUsePath(this.args.keyId));

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

  private opened = openedFor();

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
      let share = this.shareOf(key.sharedInto);
      this.form.realms = realms;
      this.page.state = { name: 'choosing', key, share };
      this.args.api.visit.loaded();
      if (share) {
        this.selectRealm(share.workspace.url);
      } else if (realms.length === 1) {
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

  // The share the page was opened for, among the key's own. A link naming
  // one the key doesn't have, or one that's suspended, says so rather than
  // setting up the key itself.
  private shareOf(sharedInto: SharedWorkspace[]): ForShare | undefined {
    let { realm, share: shareId } = this.opened;
    if (!shareId) {
      return undefined;
    }
    let workspace = sharedInto.find((w) => w.url === realm);
    let share = workspace?.shares.find((s) => s.id === shareId);
    if (!workspace || !share) {
      throw new LinkError(
        'the shared key this page names isn’t one of this key’s shares',
        'This key isn’t shared there. The share may have been removed.',
      );
    }
    if (share.state !== 'active') {
      throw new LinkError(
        'the shared key this page names is suspended',
        'This shared key is suspended, so no card can use it.',
      );
    }
    return { id: share.id, label: share.label, workspace };
  }

  private selectRealm = async (url: string) => {
    this.form.realm = url;
    this.form.card = undefined;
    this.form.cards = [];
    this.form.error = undefined;
    this.form.loadingCards = true;
    try {
      // A share sends the key it holds, so the cards are those this key can
      // fill either way.
      let cards = await realmCardsWithRequests(this.args.api.config, url, {
        slot: this.choosing?.share ? 'apiKey' : 'userKey',
        key: this.args.keyId,
      });
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

  // Each card as a tile to choose, by its place in the list, since a card
  // definition is named by its module and export together.
  private get cardChoices() {
    return this.form.cards.map((card, index) => ({
      value: String(index),
      title: card.displayName,
    }));
  }
  // '' rather than undefined when no card is chosen, so the tiles stay
  // controlled: RadioCard takes an undefined @value as uncontrolled and
  // would keep a pick of its own.
  private get chosenCard() {
    let index = this.form.card ? this.form.cards.indexOf(this.form.card) : -1;
    return index < 0 ? '' : String(index);
  }
  private cardNameOf = (index: string) => this.form.cards[Number(index)]?.name;
  private selectCard = (index: string) => {
    this.form.card = this.form.cards[Number(index)];
  };

  private goToKeys = () => navigation.back(keyPageURL());

  // The approve page reads what it is for from its fragment, so it loads as a
  // document of its own.
  private next = (event: Event) => {
    event.preventDefault();
    let { realm, card } = this.form;
    if (!realm || !card) {
      return;
    }
    let share = this.choosing?.share;
    let fragment = new URLSearchParams({
      module: card.module,
      name: card.name,
      realm,
      ...(share ? { share: share.id } : { key: this.args.keyId }),
      then: 'keys',
    });
    navigation.assign(withWayBack(`${pageURL('approve')}#${fragment}`));
  };
}

export default class UseKeyPage extends Component<{ Args: { keyId: string } }> {
  <template>
    <KeysWindow @title='Boxel · Your keys' @page='use-key' as |api|>
      <UseKey @api={{api}} @keyId={{@keyId}} />
    </KeysWindow>
  </template>
}
